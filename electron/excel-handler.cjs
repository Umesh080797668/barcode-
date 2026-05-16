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

function readExcel(filePath) {
  if (!fs.existsSync(filePath)) {
    latestRowsCache = [];
    return { headers: [], rows: [], sheetNames: [], success: false, error: "File not found. Please select an existing Excel file." };
  }
  try {
    const workbook = XLSX.readFile(filePath);
    const sheetNames = workbook.SheetNames;
    const sheetName = currentSheetNameCache && sheetNames.includes(currentSheetNameCache) 
        ? currentSheetNameCache 
        : sheetNames[0];
    
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

function updateExcel(filePath, barcode, columnConfig, sheetName = 'Sheet1') {
  try {
    const barcodeCol = columnConfig.barcodeColumn || 'Barcode';
    const qtyCol     = columnConfig.quantityColumn || 'Quantity';
    const tsCol      = columnConfig.timestampColumn || 'Last Scanned';

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
      rows[existingIndex][qtyCol] = (rows[existingIndex][qtyCol] || 0) + 1;
      rows[existingIndex][tsCol]  = new Date().toLocaleString();
      isDuplicate = true;
    } else {
      rows.push({
        [barcodeCol]: barcode,
        [qtyCol]:     1,
        [tsCol]:      new Date().toLocaleString(),
      });
    }

    const newSheet = XLSX.utils.json_to_sheet(rows);

    if (workbook.SheetNames.length === 0) {
      XLSX.utils.book_append_sheet(workbook, newSheet, sheetName);
    } else {
      workbook.Sheets[sheetName] = newSheet;
    }

    XLSX.writeFile(workbook, filePath);
    latestRowsCache = rows;
    
    return { success: true, rows, isDuplicate, sheetNames: workbook.SheetNames };
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

module.exports = { readExcel, updateExcel, undoLastScan, redoLastScan, exportToCSV };
