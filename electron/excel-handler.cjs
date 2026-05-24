const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

let undoStack = [];
let redoStack = [];
const MAX_HISTORY = 10;

// Cache the latest JSON output for CSV export
let latestRowsCache = null;
let currentSheetNameCache = 'Sheet1';

// Pending write queue stored in OS temp directory
const PENDING_DIR = path.join(os.tmpdir(), 'scanvault_pending');
function ensurePendingDir() {
  try { if (!fs.existsSync(PENDING_DIR)) fs.mkdirSync(PENDING_DIR, { recursive: true }); } catch (e) { /* ignore */ }
}

function pendingFileHash(filePath) {
  return crypto.createHash('sha1').update(String(filePath)).digest('hex');
}

function savePendingOperation(filePath, op) {
  try {
    ensurePendingDir();
    const h = pendingFileHash(filePath);
    const fname = `${h}_${Date.now()}.json`;
    const full = path.join(PENDING_DIR, fname);
    const payload = { target: filePath, op };
    fs.writeFileSync(full, JSON.stringify(payload), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

function listPendingFilesFor(filePath) {
  try {
    ensurePendingDir();
    const h = pendingFileHash(filePath);
    return fs.readdirSync(PENDING_DIR).filter(f => f.startsWith(h + '_')).map(f => path.join(PENDING_DIR, f));
  } catch (e) { return []; }
}

function readPendingFile(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

function removePendingFile(file) {
  try { fs.unlinkSync(file); } catch (e) { }
}

function sleepSync(ms) {
  if (ms <= 0) return;
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, ms);
}

function isBusyWriteError(err) {
  const message = String(err?.message || err || '').toLowerCase();
  return message.includes('resource busy') || message.includes('ebusy') || message.includes('eacces') || message.includes('eperm') || message.includes('locked');
}

function writeWorkbookWithRetry(workbook, filePath) {
  const attempts = 4;
  let lastError = null;

  for (let i = 0; i < attempts; i += 1) {
    try {
      XLSX.writeFile(workbook, filePath);
      return;
    } catch (err) {
      lastError = err;
      if (!isBusyWriteError(err) || i === attempts - 1) {
        throw err;
      }
      sleepSync(150 * (i + 1));
    }
  }

  throw lastError;
}

// Try to flush any pending operations for this file when possible.
function flushPendingForFile(filePath) {
  const pending = listPendingFilesFor(filePath);
  if (!pending || pending.length === 0) return;

  for (const pfile of pending) {
    const obj = readPendingFile(pfile);
    if (!obj || !obj.op) { removePendingFile(pfile); continue; }
    try {
      const op = obj.op;
      // Re-run the operation type
      if (op.type === 'update') {
        // reuse existing update flow: load workbook, apply barcode update logic, write
        if (!fs.existsSync(filePath)) { removePendingFile(pfile); continue; }
        const workbook = XLSX.readFile(filePath);
        const sheetName = op.sheetName || 'Sheet1';
        if (!workbook.Sheets[sheetName]) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([]), sheetName);
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet);

        const barcodeCol = op.columnConfig?.barcodeColumn || 'Barcode';
        const qtyCol = op.columnConfig?.quantityColumn || 'Quantity';
        const tsCol = op.columnConfig?.timestampColumn || 'Last Scanned';
        const extraCols = op.columnConfig?.extraColumns || [];

        const existingIndex = rows.findIndex(r => String(r[barcodeCol]) === String(op.barcode));
        if (existingIndex >= 0) {
          rows[existingIndex][qtyCol] = (rows[existingIndex][qtyCol] || 0) + 1;
          rows[existingIndex][tsCol] = new Date().toLocaleString();
          for (const extra of extraCols) if (extra.name) rows[existingIndex][extra.name] = extra.defaultValue || '';
        } else {
          const newObj = { [barcodeCol]: op.barcode, [qtyCol]: 1, [tsCol]: new Date().toLocaleString() };
          for (const extra of extraCols) if (extra.name) newObj[extra.name] = extra.defaultValue || '';
          rows.push(newObj);
        }

        const newSheet = XLSX.utils.json_to_sheet(rows, op.columnConfig?.columnsOrder ? { header: op.columnConfig.columnsOrder } : {});
        workbook.Sheets[sheetName] = newSheet;
        writeWorkbookWithRetry(workbook, filePath);
        removePendingFile(pfile);
      } else if (op.type === 'applyStockChanges') {
        if (!fs.existsSync(filePath)) { removePendingFile(pfile); continue; }
        const workbook = XLSX.readFile(filePath);
        const sheetName = op.sheetName || 'Sheet1';
        if (!workbook.Sheets[sheetName]) { removePendingFile(pfile); continue; }
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet);

        const barcodeCol = op.columnConfig?.barcodeColumn || 'Barcode';
        const qtyCol = op.columnConfig?.quantityColumn || 'Quantity';
        const tsCol = op.columnConfig?.timestampColumn || 'Last Scanned';

        for (const ch of (op.changes || [])) {
          const bc = String(ch.barcode);
          const qtyToDec = Number(ch.quantity) || 0;
          const idx = rows.findIndex(r => String(r[barcodeCol]) === bc);
          if (idx >= 0) {
            const cur = Number(rows[idx][qtyCol] || 0);
            rows[idx][qtyCol] = Math.max(0, cur - qtyToDec);
            rows[idx][tsCol] = new Date().toLocaleString();
          }
        }

        const newSheet = XLSX.utils.json_to_sheet(rows, op.columnConfig?.columnsOrder ? { header: op.columnConfig.columnsOrder } : {});
        workbook.Sheets[sheetName] = newSheet;
        writeWorkbookWithRetry(workbook, filePath);
        removePendingFile(pfile);
      } else if (op.type === 'rewrite') {
        if (!fs.existsSync(filePath)) { removePendingFile(pfile); continue; }
        const workbook = XLSX.readFile(filePath);
        const sheetName = op.sheetName || 'Sheet1';
        const finalRows = op.rows || [];
        const newSheet = XLSX.utils.json_to_sheet(finalRows, op.columnsOrder ? { header: op.columnsOrder } : {});
        workbook.Sheets[sheetName] = newSheet;
        writeWorkbookWithRetry(workbook, filePath);
        removePendingFile(pfile);
      } else {
        // unknown op - drop it
        removePendingFile(pfile);
      }
    } catch (err) {
      // if still busy, leave the pending file for later; for other errors, drop it
      if (!isBusyWriteError(err)) removePendingFile(pfile);
    }
  }
}

function recordUndo(filePath) {
  if (fs.existsSync(filePath)) {
    try { flushPendingForFile(filePath); } catch (e) { /* ignore */ }
    const workbook = XLSX.readFile(filePath);
    undoStack.push({ filePath, workbook: JSON.parse(JSON.stringify(workbook)) });
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
  }
}

function readExcel(filePath, targetSheetName) {
  if (!fs.existsSync(filePath)) {
    latestRowsCache = [];
    return { headers: [], rows: [], sheetNames: [], success: false, error: "File not found. Please select an existing Excel file." };
  }
  try {
    // Attempt to flush any pending queued operations for this file
    try { flushPendingForFile(filePath); } catch (e) { /* ignore flush errors */ }
    const workbook = XLSX.readFile(filePath);
    const sheetNames = workbook.SheetNames;
    const sheetName = targetSheetName && sheetNames.includes(targetSheetName)
        ? targetSheetName
        : (currentSheetNameCache && sheetNames.includes(currentSheetNameCache) 
            ? currentSheetNameCache 
            : sheetNames[0]);
    
    currentSheetNameCache = sheetName;
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet);
    latestRowsCache = rows;
    
    return {
      headers: Object.keys(rows[0] || {}),
      rows,
      sheetNames,
      success: true
    };
  } catch (error) {
    return { headers: [], rows: [], sheetNames: ['Sheet1'], success: false, error: error.message };
  }
}

function updateExcel(filePath, barcode, columnConfig, sheetName = 'Sheet1', product = null) {
  try {
    const barcodeCol = columnConfig.barcodeColumn || 'Barcode';
    const qtyCol     = columnConfig.quantityColumn || 'Quantity';
    const tsCol      = columnConfig.timestampColumn || 'Last Scanned';
    const extraCols  = columnConfig.extraColumns || [];

    currentSheetNameCache = sheetName;

    // Save current state for Undo before modifying
    recordUndo(filePath);
    redoStack = []; // Clear redo stack on new action

    let workbook, rows;
    if (fs.existsSync(filePath)) {
      try { flushPendingForFile(filePath); } catch (e) { /* ignore */ }
      workbook = XLSX.readFile(filePath);
      if (!workbook.Sheets[sheetName]) {
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([]), sheetName);
      }
      const sheet = workbook.Sheets[sheetName];
      rows = XLSX.utils.sheet_to_json(sheet);
    } else {
      return { success: false, error: "File not found. Please select an existing Excel file." };
    }

    const existingIndex = rows.findIndex(
      (row) => String(row[barcodeCol]) === String(barcode)
    );

    let isDuplicate = false;

    if (existingIndex >= 0) {
      // If this barcode exists in the product DB, treat re-adding as an error to avoid
      // duplicate rows and inconsistent quantities between barcode DB and Excel.
      if (product) {
        return { success: false, error: 'Product already exists in inventory' }; 
      }

      // For unknown products (no product metadata), keep legacy behavior of incrementing quantity
      rows[existingIndex][qtyCol] = (rows[existingIndex][qtyCol] || 0) + 1;
      rows[existingIndex][tsCol]  = new Date().toLocaleString();

      for (const extra of extraCols) {
        if (extra.name) {
          rows[existingIndex][extra.name] = extra.defaultValue || '';
        }
      }
      isDuplicate = true;
    } else {
      // If product exists, prefill name/price and use product.quantity if provided
      const qtyVal = product && (product.quantity !== undefined && product.quantity !== null)
        ? Number(product.quantity)
        : 1;

      const newObj = {
        [barcodeCol]: barcode,
        [qtyCol]:     qtyVal,
        [tsCol]:      new Date().toLocaleString(),
      };

      if (product) {
        if (product.name !== undefined) newObj['Name'] = product.name;
        if (product.price !== undefined) newObj['Price'] = product.price;
      }

      for (const extra of extraCols) {
        if (extra.name) {
          newObj[extra.name] = extra.defaultValue || '';
        }
      }

      rows.push(newObj);
    }

    const newSheet = XLSX.utils.json_to_sheet(rows, columnConfig.columnsOrder ? { header: columnConfig.columnsOrder } : {});

    if (workbook.SheetNames.length === 0) {
      XLSX.utils.book_append_sheet(workbook, newSheet, sheetName);
    } else {
      workbook.Sheets[sheetName] = newSheet;
    }

    writeWorkbookWithRetry(workbook, filePath);
    latestRowsCache = rows;
    
    // Ensure that even if a file was previously empty, we return all keys nicely padded so the UI can draw all table columns
    let updatedHeaders = [];
    if (rows.length > 0) {
        // Collect all unique keys from all rows to ensure extra columns appear
        const keySet = new Set();
        rows.forEach(r => Object.keys(r).forEach(k => keySet.add(k)));
        updatedHeaders = Array.from(keySet);
    }
    
    return { success: true, rows, isDuplicate, sheetNames: workbook.SheetNames, headers: updatedHeaders };
  } catch (err) {
    if (isBusyWriteError(err)) {
      // save this update as a pending operation to be flushed later
      try {
        savePendingOperation(filePath, { type: 'update', barcode, columnConfig, sheetName, product });
        return { success: true, queued: true, message: 'File busy — update queued' };
      } catch (e) {
        return { success: false, error: 'File busy and failed to queue update' };
      }
    }
    return { success: false, error: err.message };
  }
}

function undoLastScan(filePath) {
  if (undoStack.length === 0) return { success: false, error: "No history to undo" };
  try {
    if (fs.existsSync(filePath)) {
        redoStack.push({ filePath, workbook: JSON.parse(JSON.stringify(XLSX.readFile(filePath))) });
    }
    const lastState = undoStack.pop();
    writeWorkbookWithRetry(lastState.workbook, filePath);
    return readExcel(filePath);
  } catch (err) {
    if (isBusyWriteError(err)) {
      return { success: false, error: 'The Excel file is busy or open in another program. Close it and try undo again.' };
    }
    return { success: false, error: "Undo failed: " + err.message };
  }
}

function redoLastScan(filePath) {
  if (redoStack.length === 0) return { success: false, error: "No history to redo" };
  try {
    if (fs.existsSync(filePath)) {
        undoStack.push({ filePath, workbook: JSON.parse(JSON.stringify(XLSX.readFile(filePath))) });
    }
    const nextState = redoStack.pop();
    writeWorkbookWithRetry(nextState.workbook, filePath);
    return readExcel(filePath);
  } catch (err) {
    if (isBusyWriteError(err)) {
      return { success: false, error: 'The Excel file is busy or open in another program. Close it and try redo again.' };
    }
    return { success: false, error: "Redo failed: " + err.message };
  }
}

function exportToCSV() {
  if (!latestRowsCache || latestRowsCache.length === 0) return null;
  const headers = Object.keys(latestRowsCache[0]);
  const csvRows = [headers.join(',')];
  for (const row of latestRowsCache) {
    const rowValues = headers.map(header => {
      const val = row[header] !== undefined ? String(row[header]) : '';
      return `"${val.replace(/"/g, '""')}"`;
    });
    csvRows.push(rowValues.join(','));
  }
  return csvRows.join('\n');
}

function rewriteExcel(filePath, sheetName, rows, columnsOrder) {
  try {
    if (!fs.existsSync(filePath)) return { success: false, error: "File not found." };
    try { flushPendingForFile(filePath); } catch (e) { /* ignore */ }
    const workbook = XLSX.readFile(filePath);
    redoStack = []; // Clear redo stack on structural edit
    recordUndo(filePath);
    
    // Process new columns to ensure defaults appear in all existing rows if they are missing
    let finalRows = rows;
    if (columnsOrder) {
       finalRows = rows.map(r => {
           const newR = { ...r };
           // missing keys will be written by json_to_sheet because of `{ header: columnsOrder }`
           return newR;
       });
    }

    const newSheet = XLSX.utils.json_to_sheet(finalRows, columnsOrder ? { header: columnsOrder } : {});
    if (!workbook.Sheets[sheetName]) {
      XLSX.utils.book_append_sheet(workbook, newSheet, sheetName);
    } else {
      workbook.Sheets[sheetName] = newSheet;
    }
    
    writeWorkbookWithRetry(workbook, filePath);
    latestRowsCache = finalRows;
    return { success: true };
  } catch (err) {
    if (isBusyWriteError(err)) {
      try {
        savePendingOperation(filePath, { type: 'rewrite', sheetName, rows, columnsOrder });
        return { success: true, queued: true, message: 'File busy — rewrite queued' };
      } catch (e) {
        return { success: false, error: 'File busy and failed to queue rewrite' };
      }
    }
    return { success: false, error: err.message };
  }
}

module.exports = { readExcel, updateExcel, undoLastScan, redoLastScan, exportToCSV, rewriteExcel, flushPendingForFile };

// Flush all pending operation files in the temp folder
function flushAllPending() {
  try {
    ensurePendingDir();
    const files = fs.readdirSync(PENDING_DIR).map(f => path.join(PENDING_DIR, f));
    const seenTargets = new Set();
    for (const f of files) {
      const obj = readPendingFile(f);
      if (!obj || !obj.target) { removePendingFile(f); continue; }
      if (seenTargets.has(obj.target)) continue;
      try { flushPendingForFile(obj.target); } catch (e) { /* ignore per-file errors */ }
      seenTargets.add(obj.target);
    }
  } catch (e) { /* ignore */ }
}

module.exports.flushAllPending = flushAllPending;
// Apply stock changes: decrement quantities in the sheet for given barcode changes
async function applyStockChanges(filePath, changes = [], columnConfig = {}, sheetName = 'Sheet1') {
  try {
    if (!fs.existsSync(filePath)) return { success: false, error: 'File not found.' };
    const workbook = XLSX.readFile(filePath);
    if (!workbook.Sheets[sheetName]) return { success: false, error: 'Sheet not found.' };
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet);

    const barcodeCol = columnConfig.barcodeColumn || 'Barcode';
    const qtyCol = columnConfig.quantityColumn || 'Quantity';
    const tsCol = columnConfig.timestampColumn || 'Last Scanned';

    const updated = [];
    for (const ch of changes) {
      const bc = String(ch.barcode);
      const qtyToDec = Number(ch.quantity) || 0;
      const idx = rows.findIndex(r => String(r[barcodeCol]) === bc);
      if (idx >= 0) {
        const cur = Number(rows[idx][qtyCol] || 0);
        const next = Math.max(0, cur - qtyToDec);
        rows[idx][qtyCol] = next;
        rows[idx][tsCol] = new Date().toLocaleString();
        updated.push({ barcode: bc, before: cur, after: next });
      } else {
        // skip if not found
        updated.push({ barcode: bc, error: 'not-found' });
      }
    }

    const newSheet = XLSX.utils.json_to_sheet(rows, columnConfig.columnsOrder ? { header: columnConfig.columnsOrder } : {});
    workbook.Sheets[sheetName] = newSheet;
    writeWorkbookWithRetry(workbook, filePath);
    latestRowsCache = rows;
    return { success: true, updated, rows, sheetNames: workbook.SheetNames };
  } catch (err) {
    if (isBusyWriteError(err)) {
      try {
        savePendingOperation(filePath, { type: 'applyStockChanges', changes, columnConfig, sheetName });
        return { success: true, queued: true, message: 'File busy — stock changes queued' };
      } catch (e) {
        return { success: false, error: 'File busy and failed to queue stock changes' };
      }
    }
    return { success: false, error: err.message };
  }
}

module.exports.applyStockChanges = applyStockChanges;
