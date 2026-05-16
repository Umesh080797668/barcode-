const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const excelHandler = require('./excel-handler.cjs');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Dev: load Vite dev server | Production: load built files
  const isDev = process.env.NODE_ENV !== 'production';
  mainWindow.loadURL(
    isDev
      ? 'http://localhost:5173'
      : `file://${path.join(__dirname, '../dist/index.html')}`
  );
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC: Read Excel file
ipcMain.handle('excel:read', async (_, filePath) => {
  return excelHandler.readExcel(filePath);
});

// IPC: Process a scanned barcode → update Excel
ipcMain.handle('excel:update', async (_, { filePath, barcode, columnConfig, sheetName }) => {
  return excelHandler.updateExcel(filePath, barcode, columnConfig, sheetName);
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
