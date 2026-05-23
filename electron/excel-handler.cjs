const XLSX = require('xlsx');
const fs = require('fs');

let undoStack = [];
let redoStack = [];
const MAX_HISTORY = 10;

// Cache the latest JSON output for CSV export
let latestRowsCache = null;
let currentSheetNameCache = 'Sheet1';

function recordUndo(filePath) {
  if (fs.existsSync(filePath)) {
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

    XLSX.writeFile(workbook, filePath);
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
    XLSX.writeFile(lastState.workbook, filePath);
    return readExcel(filePath);
  } catch (err) {
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
    XLSX.writeFile(nextState.workbook, filePath);
    return readExcel(filePath);
  } catch (err) {
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
    
    XLSX.writeFile(workbook, filePath);
    latestRowsCache = finalRows;
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { readExcel, updateExcel, undoLastScan, redoLastScan, exportToCSV, rewriteExcel };
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
    XLSX.writeFile(workbook, filePath);
    latestRowsCache = rows;
    return { success: true, updated, rows, sheetNames: workbook.SheetNames };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports.applyStockChanges = applyStockChanges;
