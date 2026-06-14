const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const BarcodeDB = require('./barcode-db.cjs');
const printHandler = require('./print-handler.cjs');
const fs = require('fs');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

let mainWindow;
let barcodeDB;

// ── Paths ──────────────────────────────────────────────────────────────────

function getShopConfigPath() {
  return path.join(app.getPath('userData'), 'shop-config.json');
}

function getCsvConfigPath() {
  return path.join(app.getPath('userData'), 'csv-export-config.json');
}

function readShopConfig() {
  const configPath = getShopConfigPath();
  if (!fs.existsSync(configPath)) return {};
  try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (_) { return {}; }
}

function writeShopConfig(config) {
  fs.writeFileSync(getShopConfigPath(), JSON.stringify(config || {}, null, 2), 'utf8');
}

function readCsvConfig() {
  const p = getCsvConfigPath();
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return {}; }
}

function writeCsvConfig(config) {
  fs.writeFileSync(getCsvConfigPath(), JSON.stringify(config || {}, null, 2), 'utf8');
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function getBackupDirPath() {
  const dirPath = path.join(app.getPath('userData'), 'ScanVault Backups');
  ensureDir(dirPath);
  return dirPath;
}

function getBackupFilePath() {
  return path.join(getBackupDirPath(), 'scanvault-backup.json');
}

// ── CSV Builder ────────────────────────────────────────────────────────────

function escapeCsvVal(val) {
  const s = val === undefined || val === null ? '' : String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowsToCsv(headers, rows) {
  const lines = [headers.map(escapeCsvVal).join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => escapeCsvVal(row[h])).join(','));
  }
  return lines.join('\n');
}

/**
 * Build a comprehensive CSV from the database covering:
 *  - Products (with custom fields expanded)
 *  - Invoices summary
 *  - Invoice line items
 */
async function buildFullCsvFromDb() {
  const snapshot = await barcodeDB.exportBackupSnapshot();
  const sections = [];

  // ── Products ──
  const products = snapshot.products || [];
  // Collect all custom-field keys across all products
  const cfKeys = new Set();
  for (const p of products) {
    if (p.custom_fields) {
      let cf;
      try { cf = typeof p.custom_fields === 'string' ? JSON.parse(p.custom_fields) : p.custom_fields; } catch (_) { cf = {}; }
      Object.keys(cf).forEach(k => cfKeys.add(k));
    }
  }
  const cfKeysArr = Array.from(cfKeys);
  const productHeaders = ['barcode', 'name', 'sku', 'price', 'quantity', 'modal', 'category', 'scan_mode', 'created_at', 'updated_at', ...cfKeysArr];
  const productRows = products.map(p => {
    let cf = {};
    if (p.custom_fields) {
      try { cf = typeof p.custom_fields === 'string' ? JSON.parse(p.custom_fields) : p.custom_fields; } catch (_) { cf = {}; }
    }
    const row = { ...p };
    cfKeysArr.forEach(k => { row[k] = cf[k] ?? ''; });
    return row;
  });

  sections.push('### PRODUCTS ###');
  sections.push(rowsToCsv(productHeaders, productRows));

  // ── Invoices ──
  const invoices = snapshot.invoices || [];
  const invoiceHeaders = ['invoice_no', 'customer_name', 'customer_phone', 'cashier', 'subtotal', 'discount', 'total', 'paid_cash', 'balance', 'status', 'transaction_type', 'return_reason', 'created_at'];
  sections.push('\n### INVOICES ###');
  sections.push(rowsToCsv(invoiceHeaders, invoices));

  // ── Invoice Items ──
  const invoiceItems = snapshot.invoiceItems || [];
  const itemHeaders = ['invoice_no', 'barcode', 'name', 'price', 'quantity', 'discount', 'net_price', 'total', 'warranty', 'remaining_warranty'];
  sections.push('\n### INVOICE ITEMS ###');
  sections.push(rowsToCsv(itemHeaders, invoiceItems));

  // ── Custom Field Definitions ──
  const customFields = snapshot.customFields || [];
  const cfDefHeaders = ['id', 'label', 'field_type', 'default_val', 'sort_order'];
  sections.push('\n### CUSTOM FIELD DEFINITIONS ###');
  sections.push(rowsToCsv(cfDefHeaders, customFields));

  // ── Metadata footer ──
  const meta = [
    `\n### EXPORT METADATA ###`,
    `"Exported At","${new Date().toLocaleString()}"`,
    `"App Version","${app.getVersion()}"`,
    `"Total Products","${products.length}"`,
    `"Total Invoices","${invoices.length}"`,
    `"Total Invoice Items","${invoiceItems.length}"`,
  ];
  sections.push(meta.join('\n'));

  return sections.join('\n');
}

/** Write CSV to path, then mark it read-only */
function writeCsvReadOnly(filePath, csvData) {
  // If file is read-only, make it writable first so we can overwrite
  if (fs.existsSync(filePath)) {
    try { fs.chmodSync(filePath, 0o644); } catch (_) { /* ignore on Windows */ }
  }
  fs.writeFileSync(filePath, csvData, 'utf8');
  // Make read-only: 0o444 = r--r--r--
  try { fs.chmodSync(filePath, 0o444); } catch (_) { /* ignore on Windows */ }
}

// ── Auto Backup Scheduler (9 AM daily) ────────────────────────────────────

let autoBackupTimer = null;

function msUntil9AM() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(9, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

async function runAutoBackup() {
  try {
    const csvData = await buildFullCsvFromDb();
    const backupDir = getBackupDirPath();

    // 1. Write the master JSON backup (for restore)
    const snapshot = await barcodeDB.exportBackupSnapshot();
    const backupJson = JSON.stringify({
      createdAt: new Date().toISOString(),
      appVersion: app.getVersion(),
      shopConfig: readShopConfig(),
      ...snapshot,
    }, null, 2);
    fs.writeFileSync(getBackupFilePath(), backupJson, 'utf8');

    // 2. Write an auto-backup CSV alongside it (read-only)
    const csvPath = path.join(backupDir, 'scanvault-auto-backup.csv');
    writeCsvReadOnly(csvPath, csvData);

    // 3. Also update the user-configured CSV export path if set
    const csvConfig = readCsvConfig();
    if (csvConfig.exportPath && csvConfig.exportPath.trim()) {
      try {
        writeCsvReadOnly(csvConfig.exportPath, csvData);
      } catch (_) { /* best-effort */ }
    }

    // Notify renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('autoBackup:complete', {
        backupPath: getBackupFilePath(),
        csvPath,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.error('[AutoBackup] Failed:', err.message);
  }
}

function scheduleNextAutoBackup() {
  clearTimeout(autoBackupTimer);
  const delay = msUntil9AM();
  autoBackupTimer = setTimeout(async () => {
    await runAutoBackup();
    scheduleNextAutoBackup(); // reschedule for next day
  }, delay);
}

// ── Window ─────────────────────────────────────────────────────────────────

function createWindow() {
  const appIconPath = path.join(app.getAppPath(), 'build', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'ScanVault',
    backgroundColor: '#0d0e11',
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  } else {
    mainWindow.loadURL('http://localhost:5173');
  }
}

app.whenReady().then(() => {
  barcodeDB = new BarcodeDB(app);
  createWindow();
  scheduleNextAutoBackup();
});

app.on('before-quit', () => {
  barcodeDB?.flushNow?.();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── App version ────────────────────────────────────────────────────────────

ipcMain.handle('app:getVersion', async () => ({ success: true, version: app.getVersion() }));

// ── Window Management ────────────────────────────────────────────────────

ipcMain.handle('window:openUsedPurchase', async () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }

  const appIconPath = path.join(app.getAppPath(), 'build', 'icon.png');
  const upWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    minWidth: 900,
    minHeight: 600,
    title: 'ScanVault - Used Purchase',
    backgroundColor: '#0d0e11',
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Remove standard menu for standard "kiosk-like" behavior
  upWindow.setMenu(null);

  upWindow.on('closed', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  if (app.isPackaged) {
    upWindow.loadFile(path.join(__dirname, '../dist/index.html'), { hash: 'used-purchase' });
  } else {
    upWindow.loadURL('http://localhost:5173/#used-purchase');
  }
  return { success: true };
});

// ── CSV Export ─────────────────────────────────────────────────────────────

/** Return the saved export path (or null) */
ipcMain.handle('csv:getExportPath', async () => {
  const config = readCsvConfig();
  return { success: true, exportPath: config.exportPath || null };
});

/** Let user pick/change the CSV export path */
ipcMain.handle('csv:setExportPath', async () => {
  const config = readCsvConfig();
  const defaultPath = config.exportPath || path.join(app.getPath('documents'), 'scanvault-export.csv');
  const { filePath: savePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    title: 'Set CSV Export Location',
    defaultPath,
    filters: [{ name: 'CSV Files', extensions: ['csv'] }],
  });
  if (canceled || !savePath) return { success: false, error: 'Cancelled' };
  writeCsvConfig({ ...config, exportPath: savePath });
  return { success: true, exportPath: savePath };
});

/** Export all DB data to the saved (or newly selected) CSV path — overwrites, marks read-only */
ipcMain.handle('csv:exportAll', async () => {
  try {
    let config = readCsvConfig();
    let exportPath = config.exportPath || null;

    // If no path is set yet, prompt the user to choose one
    if (!exportPath) {
      const { filePath: savePath, canceled } = await dialog.showSaveDialog(mainWindow, {
        title: 'Choose CSV Export Location',
        defaultPath: path.join(app.getPath('documents'), 'scanvault-export.csv'),
        filters: [{ name: 'CSV Files', extensions: ['csv'] }],
      });
      if (canceled || !savePath) return { success: false, error: 'Export cancelled — no location selected' };
      exportPath = savePath;
      writeCsvConfig({ ...config, exportPath });
    }

    const csvData = await buildFullCsvFromDb();
    writeCsvReadOnly(exportPath, csvData);
    return { success: true, filePath: exportPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── Backup & Restore ───────────────────────────────────────────────────────

ipcMain.handle('backup:create', async (event) => {
  try {
    const send = (status, phase, progress, details) =>
      event.sender.send('backup:progress', { operation: 'backup:create', status, phase, progress, details });

    send('running', 'Collecting database snapshot', 20, 'Reading products, invoices, settings');
    const snapshot = await barcodeDB.exportBackupSnapshot();

    send('running', 'Building backup', 60, 'Serialising data');
    const backupJson = JSON.stringify({
      createdAt: new Date().toISOString(),
      appVersion: app.getVersion(),
      shopConfig: readShopConfig(),
      ...snapshot,
    }, null, 2);

    send('running', 'Writing file', 85, 'Saving backup');
    const backupPath = getBackupFilePath();
    fs.writeFileSync(backupPath, backupJson, 'utf8');

    // Also write a companion CSV (read-only)
    const csvData = await buildFullCsvFromDb();
    const csvPath = path.join(getBackupDirPath(), 'scanvault-auto-backup.csv');
    writeCsvReadOnly(csvPath, csvData);

    send('success', 'Backup completed', 100, `Saved to ${path.basename(backupPath)}`);
    return {
      success: true,
      backupPath,
      productCount: snapshot.products?.length || 0,
      invoiceCount: snapshot.invoices?.length || 0,
    };
  } catch (err) {
    event.sender.send('backup:progress', { operation: 'backup:create', status: 'error', phase: 'Backup failed', progress: 100, details: err.message });
    return { success: false, error: err.message };
  }
});

ipcMain.handle('backup:restore', async (event) => {
  try {
    const send = (status, phase, progress, details) =>
      event.sender.send('backup:progress', { operation: 'backup:restore', status, phase, progress, details });

    let backupPath = getBackupFilePath();

    // Allow user to select a different backup file
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Backup File',
      defaultPath: getBackupDirPath(),
      properties: ['openFile'],
      filters: [{ name: 'JSON Backup', extensions: ['json'] }],
    });
    if (!selected.canceled && selected.filePaths?.[0]) {
      backupPath = selected.filePaths[0];
    }

    if (!fs.existsSync(backupPath)) {
      return { success: false, error: 'Backup file not found' };
    }

    send('running', 'Reading backup', 20, 'Parsing backup file');
    const raw = fs.readFileSync(backupPath, 'utf8');
    const backup = JSON.parse(raw);

    send('running', 'Restoring database', 60, 'Merging products, invoices, settings');
    const dbResult = await barcodeDB.restoreBackupSnapshot(backup);
    if (backup.shopConfig) writeShopConfig(backup.shopConfig);

    send('success', 'Restore completed', 100, `Products: ${dbResult.productsInserted + dbResult.productsUpdated}, Invoices: ${dbResult.invoicesInserted + dbResult.invoicesUpdated}`);
    return { success: true, backupPath, ...dbResult };
  } catch (err) {
    event.sender.send('backup:progress', { operation: 'backup:restore', status: 'error', phase: 'Restore failed', progress: 100, details: err.message });
    return { success: false, error: err.message };
  }
});

/** Manually trigger the auto-backup right now */
ipcMain.handle('backup:runNow', async () => {
  try {
    await runAutoBackup();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/** Get info about the next scheduled auto-backup */
ipcMain.handle('backup:getScheduleInfo', async () => {
  const msLeft = msUntil9AM();
  const nextRun = new Date(Date.now() + msLeft);
  return {
    success: true,
    nextRunAt: nextRun.toISOString(),
    nextRunLocal: nextRun.toLocaleTimeString(),
    backupDir: getBackupDirPath(),
  };
});

// ── Barcode / Product DB IPC ───────────────────────────────────────────────

ipcMain.handle('barcode:generate', async () => ({ barcode: barcodeDB.generateBarcodeNumber() }));

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

// ── Billing / Invoice IPC ──────────────────────────────────────────────────

ipcMain.handle('invoice:save', async (_, invoice) => {
  try { return await barcodeDB.saveInvoice(invoice); }
  catch (e) { return { success: false, error: e.message }; }
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

// ── Supplier Returns IPC ───────────────────────────────────────────────────

ipcMain.handle('returns:save', async (_, data) => {
  try { return await barcodeDB.saveSupplierReturn(data); }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('returns:getAll', async (_, limit) => {
  try { return { success: true, returns: await barcodeDB.getSupplierReturns(limit) }; }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('returns:delete', async (_, id) => {
  try { return await barcodeDB.deleteSupplierReturn(id); }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('returns:receiveReplacement', async (_, { id, data }) => {
  try { return await barcodeDB.receiveSupplierReplacement(id, data); }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('invoice:update', async (_, { invoiceNo, invoice }) => {
  try { return await barcodeDB.updateInvoice(invoiceNo, invoice); }
  catch (e) { return { success: false, error: e.message }; }
});

// ── Printer IPC ────────────────────────────────────────────────────────────

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

// ── Shop Settings IPC ──────────────────────────────────────────────────────

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

// ── Update IPC ─────────────────────────────────────────────────────────────

ipcMain.handle('update:downloadAndInstall', async (event, { url, filename }) => {
  try {
    if (!url) return { success: false, error: 'Missing update URL' };
    const updateDir = path.join(app.getPath('downloads'), 'ScanVault Updates');
    fs.mkdirSync(updateDir, { recursive: true });
    let resolvedName = filename;
    if (!resolvedName) {
      try { resolvedName = path.basename(new URL(url).pathname) || 'ScanVault-Update.bin'; } catch (_) { resolvedName = 'ScanVault-Update.bin'; }
    }
    const targetPath = path.join(updateDir, resolvedName);
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok || !response.body) throw new Error(`Download failed (${response.status})`);

    // Get total size for progress tracking
    const totalBytes = parseInt(response.headers.get('content-length') || '0', 10);
    let downloadedBytes = 0;

    // We can use a custom Transform stream to track progress
    const { Transform } = require('stream');
    const progressStream = new Transform({
      transform(chunk, encoding, callback) {
        downloadedBytes += chunk.length;
        if (totalBytes > 0 && event.sender && !event.sender.isDestroyed()) {
          const percent = Math.round((downloadedBytes / totalBytes) * 100);
          event.sender.send('update:progress', { percent, downloadedBytes, totalBytes });
        }
        callback(null, chunk);
      }
    });

    await pipeline(
      Readable.fromWeb(response.body),
      progressStream,
      fs.createWriteStream(targetPath)
    );

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
