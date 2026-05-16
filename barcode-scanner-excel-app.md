# Barcode Scanner → Excel Desktop Application
## Complete Technical Guide (Fully Offline)

---

## Overview

This application listens for barcode scans from a **USB or Bluetooth HID barcode scanner**, then automatically **creates or updates rows** in a local Excel file. Everything runs entirely offline — no internet connection, no network servers, no cloud services of any kind.

```
[USB / Bluetooth Barcode Scanner]
        ↓  (acts as keyboard)
[Desktop App (Electron + Node.js)]
        ↓
[Reads / Writes Local Excel File (.xlsx)]
```

---

## How Barcode Scanners Work

USB and Bluetooth HID barcode scanners **emulate a keyboard**. When you scan a barcode, the scanner types the barcode string and then sends an `Enter` keystroke — exactly as if someone typed it on a keyboard. This means:

- No drivers required
- No special SDK needed
- The app simply listens for keyboard input and treats rapid character sequences ending in `Enter` as a barcode scan

> **HID = Human Interface Device.** This is the standard protocol used by keyboards, mice, and barcode scanners alike. Your OS handles it automatically.

---

## Tech Stack

### Desktop App Framework
**Electron** (Node.js + Chromium)
- Cross-platform: Windows, macOS, Linux
- Single codebase for both the UI and system-level file access
- Runs completely offline — no network activity whatsoever

### Frontend (UI inside Electron)
| Layer | Technology |
|---|---|
| Framework | **React** (via Vite) |
| State | React `useState` / `useRef` |
| Styling | Plain CSS or Tailwind CSS |

### Excel File Handling
**SheetJS (xlsx)**
- Reads and writes `.xlsx` files directly on disk
- No Microsoft Office required
- 100% offline, no external calls

### Barcode Input
| Scanner Type | How It's Handled |
|---|---|
| **USB HID Scanner** | `keydown` event listener — zero setup |
| **Bluetooth HID Scanner** | Same as USB once paired with the PC |
| **Serial/COM Port Scanner** | `serialport` npm package (uncommon, see note below) |

> **Note on Serial scanners:** Most modern scanners default to HID (keyboard) mode. Only legacy or industrial scanners use a COM/serial port. If your scanner has a HID mode setting, use that — it's simpler and requires no extra packages.

---

## Full Project Structure

```
barcode-excel-app/
├── electron/
│   ├── main.js              # Electron main process
│   ├── preload.js           # Secure IPC bridge (renderer ↔ Node.js)
│   └── excel-handler.js     # SheetJS read/write logic
├── src/
│   ├── App.jsx              # Main React UI
│   ├── components/
│   │   ├── ScanFeed.jsx     # Live scan log sidebar
│   │   ├── ExcelPreview.jsx # Table view of current Excel data
│   │   └── Settings.jsx     # File path + column config
│   └── main.jsx
├── package.json
└── vite.config.js
```

---

## Step-by-Step Implementation

### Step 1 — Project Setup

```bash
# Create Electron + Vite + React project
npm create vite@latest barcode-excel-app -- --template react
cd barcode-excel-app

# Install dependencies (all offline-safe)
npm install electron electron-builder concurrently wait-on xlsx
npm install --save-dev @electron/rebuild
```

**`package.json` scripts:**
```json
{
  "main": "electron/main.js",
  "scripts": {
    "dev": "concurrently \"vite\" \"wait-on http://localhost:5173 && electron .\"",
    "build": "vite build && electron-builder",
    "start": "electron ."
  }
}
```

---

### Step 2 — Electron Main Process (`electron/main.js`)

```javascript
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const excelHandler = require('./excel-handler');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
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
ipcMain.handle('excel:update', async (_, { filePath, barcode, columnConfig }) => {
  return excelHandler.updateExcel(filePath, barcode, columnConfig);
});
```

---

### Step 3 — Preload Bridge (`electron/preload.js`)

```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  readExcel: (filePath) =>
    ipcRenderer.invoke('excel:read', filePath),

  updateExcel: (payload) =>
    ipcRenderer.invoke('excel:update', payload),
});
```

---

### Step 4 — Excel Handler (`electron/excel-handler.js`)

```javascript
const XLSX = require('xlsx');
const fs = require('fs');

function readExcel(filePath) {
  if (!fs.existsSync(filePath)) return { headers: [], rows: [] };
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);
  return {
    headers: Object.keys(rows[0] || {}),
    rows,
  };
}

function updateExcel(filePath, barcode, columnConfig) {
  const barcodeCol = columnConfig.barcodeColumn || 'Barcode';
  const qtyCol     = columnConfig.quantityColumn || 'Quantity';
  const tsCol      = columnConfig.timestampColumn || 'Last Scanned';

  let workbook, rows;

  if (fs.existsSync(filePath)) {
    workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet);
  } else {
    workbook = XLSX.utils.book_new();
    rows = [];
  }

  const existingIndex = rows.findIndex(
    (row) => String(row[barcodeCol]) === String(barcode)
  );

  if (existingIndex >= 0) {
    // UPDATE existing row — increment quantity, refresh timestamp
    rows[existingIndex][qtyCol] = (rows[existingIndex][qtyCol] || 0) + 1;
    rows[existingIndex][tsCol]  = new Date().toLocaleString();
  } else {
    // CREATE new row
    rows.push({
      [barcodeCol]: barcode,
      [qtyCol]:     1,
      [tsCol]:      new Date().toLocaleString(),
    });
  }

  const newSheet = XLSX.utils.json_to_sheet(rows);

  if (workbook.SheetNames.length === 0) {
    XLSX.utils.book_append_sheet(workbook, newSheet, 'Sheet1');
  } else {
    workbook.Sheets[workbook.SheetNames[0]] = newSheet;
  }

  XLSX.writeFile(workbook, filePath);
  return { success: true, rows };
}

module.exports = { readExcel, updateExcel };
```

---

### Step 5 — React UI (`src/App.jsx`)

The UI listens for `keydown` events. Scanners type characters very fast (within ~50ms per character), so a short buffer timeout distinguishes scanner input from regular keyboard typing.

```jsx
import { useState, useEffect, useRef } from 'react';

const DEFAULT_FILE = 'inventory.xlsx';
const COLUMN_CONFIG = {
  barcodeColumn:   'Barcode',
  quantityColumn:  'Quantity',
  timestampColumn: 'Last Scanned',
};

export default function App() {
  const [filePath, setFilePath] = useState(DEFAULT_FILE);
  const [scans, setScans]       = useState([]);
  const [rows, setRows]         = useState([]);
  const [headers, setHeaders]   = useState([]);
  const [lastStatus, setStatus] = useState('Waiting for scan...');

  const barcodeBuffer = useRef('');
  const bufferTimer   = useRef(null);

  // Load existing Excel data on startup
  useEffect(() => {
    window.electronAPI.readExcel(filePath).then(({ headers, rows }) => {
      setHeaders(headers);
      setRows(rows);
    });
  }, [filePath]);

  // ── Barcode Scanner Input (HID keyboard emulation) ──────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Enter') {
        const barcode = barcodeBuffer.current.trim();
        barcodeBuffer.current = '';
        clearTimeout(bufferTimer.current);
        if (barcode.length > 2) processBarcode(barcode);
      } else if (e.key.length === 1) {
        // Collect only printable characters
        barcodeBuffer.current += e.key;
        // If no more chars arrive within 100ms, discard (not a scanner)
        clearTimeout(bufferTimer.current);
        bufferTimer.current = setTimeout(() => {
          barcodeBuffer.current = '';
        }, 100);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filePath]);

  async function processBarcode(barcode) {
    setStatus(`Processing: ${barcode}`);
    const result = await window.electronAPI.updateExcel({
      filePath,
      barcode,
      columnConfig: COLUMN_CONFIG,
    });

    if (result.success) {
      const newHeaders = result.rows[0] ? Object.keys(result.rows[0]) : headers;
      setHeaders(newHeaders);
      setRows(result.rows);
      setScans((prev) => [
        { barcode, time: new Date().toLocaleTimeString() },
        ...prev.slice(0, 99),
      ]);
      setStatus(`✅ Updated: ${barcode}`);
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif', fontSize: 14 }}>

      {/* ── Sidebar ── */}
      <div style={{ width: 260, background: '#1e1e2e', color: '#cdd6f4', padding: 16, overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 12px' }}>🔍 Scan Log</h3>
        <div style={{ marginBottom: 12, fontSize: 12, color: '#a6e3a1' }}>{lastStatus}</div>
        {scans.map((s, i) => (
          <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid #313244' }}>
            <div style={{ fontWeight: 'bold', wordBreak: 'break-all' }}>{s.barcode}</div>
            <div style={{ fontSize: 11, color: '#a6adc8' }}>{s.time}</div>
          </div>
        ))}
      </div>

      {/* ── Main Area ── */}
      <div style={{ flex: 1, padding: 24, overflowY: 'auto', background: '#f8f8f2' }}>
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>📊 Excel Data</h2>
          <label style={{ fontSize: 12, color: '#555' }}>
            File:{' '}
            <input
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              style={{ width: 300, marginLeft: 8, padding: '2px 6px' }}
            />
          </label>
        </div>

        {rows.length === 0 ? (
          <p style={{ color: '#888' }}>No data yet. Start scanning.</p>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr style={{ background: '#6c91c2', color: '#fff' }}>
                {headers.map((h) => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f0f0f0' }}>
                  {headers.map((h) => (
                    <td key={h} style={{ padding: '6px 12px', borderBottom: '1px solid #ddd' }}>
                      {String(row[h] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

---

## Dependency List

```json
{
  "dependencies": {
    "electron": "^29.0.0",
    "react": "^18.0.0",
    "react-dom": "^18.0.0",
    "xlsx": "^0.18.5"
  },
  "devDependencies": {
    "vite": "^5.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "electron-builder": "^24.0.0",
    "concurrently": "^8.0.0",
    "wait-on": "^7.0.0"
  }
}
```

> No network packages. No HTTP servers. No internet dependencies of any kind.

---

## Build & Distribution

```bash
# Package for Windows (.exe installer)
npm run build -- --win

# Package for macOS (.dmg)
npm run build -- --mac

# Package for Linux (.AppImage)
npm run build -- --linux
```

Output goes to `dist/`. The installer is fully self-contained — no Node.js, no internet, no runtime dependencies needed on the target machine.

---

## Excel File Schema (Default)

| Barcode | Quantity | Last Scanned |
|---|---|---|
| 8901030870054 | 3 | 5/16/2025, 9:00:00 AM |
| 4006381333931 | 1 | 5/16/2025, 9:05:00 AM |

- **Barcode exists** → Quantity incremented by 1, timestamp updated
- **New barcode** → New row created with Quantity = 1

Column names are configurable via the `COLUMN_CONFIG` constant in `App.jsx`.

---

## Architecture Summary

```
USB / Bluetooth Barcode Scanner
  │  (HID keyboard emulation — no drivers needed)
  ↓
Electron Renderer (React)
  │  keydown listener with 100ms buffer
  ↓
Electron IPC  (ipcMain / preload bridge)
  ↓
SheetJS  (excel-handler.js)
  │  reads & writes .xlsx directly on disk
  ↓
inventory.xlsx  ←  stays on the local machine, always
```

---

## Optional Enhancements (All Offline)

| Feature | How to Add |
|---|---|
| **Beep on successful scan** | Bundle a `beep.wav` and play with `new Audio('./beep.wav').play()` |
| **Error beep on duplicate** | Play a different tone when the barcode already exists |
| **Multiple Excel sheets** | Add a sheet-name selector UI; pass it to `XLSX.utils.book_append_sheet` |
| **Export to CSV** | Use `XLSX.utils.sheet_to_csv()` and write with `fs.writeFileSync()` |
| **Serial/COM port scanner** | Add the `serialport` package; listen on the COM port instead of keyboard events |
| **Custom columns** | Extend `COLUMN_CONFIG` with fields like `ProductName`, `Location`, `Price` |
| **Undo last scan** | Keep a scan history stack; reverse the last `updateExcel` call |

---

*Built with Electron · React · SheetJS — fully offline, zero network activity*
