import { useState, useEffect, useRef } from 'react';
import './App.css';

export default function App() {
  const [filePath, setFilePath] = useState('');
  const [sheetName, setSheetName] = useState('Sheet1');
  const [availableSheets, setAvailableSheets] = useState(['Sheet1']);
  const [scans, setScans]       = useState([]);
  const [rows, setRows]         = useState([]);
  const [headers, setHeaders]   = useState([]);
  const [lastStatus, setStatus] = useState('Waiting for scan...');
  
  // Custom Columns State
  const [barcodeColName, setBarcodeColName] = useState('Barcode');
  const [quantityColName, setQuantityColName] = useState('Quantity');
  const [timestampColName, setTimestampColName] = useState('Last Scanned');

  const barcodeBuffer = useRef('');
  const bufferTimer   = useRef(null);

  // Audio Context refs (we use standard browser Audio)
  const successAudio = useRef(new Audio('data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU')); // Dummy base64, will just trigger browser native beep or fail silently without local file
  const errorAudio = useRef(new Audio('data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU'));

  const playBeep = (type) => {
    console.log(`Playing ${type} beep...`);
    try {
        if (type === 'success') successAudio.current.play().catch(()=>console.log('Audio blocked'));
        if (type === 'duplicate') errorAudio.current.play().catch(()=>console.log('Audio blocked'));
    } catch(e) {}
  };

  const loadData = () => {
    if (!window.electronAPI || !filePath) return;
    window.electronAPI.readExcel(filePath).then((result) => {
      if (result.success) {
        setHeaders(result.headers || []);
        setRows(result.rows || []);
        setAvailableSheets(result.sheetNames || ['Sheet1']);
        if (result.sheetNames && !result.sheetNames.includes(sheetName)) {
           setSheetName(result.sheetNames[0] || 'Sheet1');
        }
      } else {
        setStatus(`ℹ️ ${result.error}`);
      }
    });
  };

  useEffect(() => {
    loadData();
  }, [filePath, sheetName]);

  // ── Barcode Scanner Input (HID keyboard emulation) ──────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if typing in an input field
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

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
  });

  async function processBarcode(barcode) {
    if (!window.electronAPI) return;
    if (!filePath) {
        setStatus('⚠️ Please select an Excel file first!');
        return;
    }
    setStatus(`Processing: ${barcode}`);
    const columnConfig = {
        barcodeColumn: barcodeColName,
        quantityColumn: quantityColName,
        timestampColumn: timestampColName
    };

    const result = await window.electronAPI.updateExcel({
      filePath,
      barcode,
      columnConfig,
      sheetName
    });

    if (result.success) {
      if (result.isDuplicate) {
          playBeep('duplicate');
      } else {
          playBeep('success');
      }

      const newHeaders = result.rows[0] ? Object.keys(result.rows[0]) : headers;
      setHeaders(newHeaders);
      setRows(result.rows);
      setAvailableSheets(result.sheetNames);
      setScans((prev) => [
        { barcode, time: new Date().toLocaleTimeString() },
        ...prev.slice(0, 99),
      ]);
      setStatus(`✅ Updated: ${barcode}`);
    } else {
      setStatus(`❌ Error: ${result.error}`);
    }
  }

  const handleSelectFile = async () => {
    if (!window.electronAPI) return;
    const selectedPath = await window.electronAPI.selectFile();
    if (selectedPath) {
      setFilePath(selectedPath);
      setStatus(`📁 Selected: ${selectedPath}`);
    }
  };

  const handleUndo = async () => {
    if (!window.electronAPI) return;
    const result = await window.electronAPI.undoScan(filePath);
    if (result.success) {
      setHeaders(result.headers || []);
      setRows(result.rows || []);
      setStatus(`⏮️ Undo completed!`);
      // Remove last scan from log
      setScans(prev => prev.slice(1));
    } else {
      setStatus(`❌ Undo Error: ${result.error}`);
    }
  };

  const handleRedo = async () => {
    if (!window.electronAPI) return;
    const result = await window.electronAPI.redoScan(filePath);
    if (result.success) {
      setHeaders(result.headers || []);
      setRows(result.rows || []);
      setStatus(`⏭️ Redo completed!`);
    } else {
      setStatus(`❌ Redo Error: ${result.error}`);
    }
  };

  const handleExport = async () => {
    if (!window.electronAPI) return;
    const result = await window.electronAPI.exportCSV(filePath);
    if (result.success) {
      setStatus(`💾 Exported successfully to ${result.filePath}`);
    } else {
      setStatus(`❌ Export Error/Cancelled: ${result.error}`);
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif', fontSize: 14 }}>

      {/* ── Sidebar ── */}
      <div style={{ width: 260, background: '#1e1e2e', color: '#cdd6f4', padding: 16, overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 12px' }}>🔍 Scan Log</h3>
        
        <div style={{ marginBottom: 16, display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button onClick={handleUndo} style={{ padding: '6px', background: '#f38ba8', color: '#111', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                ⏮️ Undo
            </button>
            <button onClick={handleRedo} style={{ padding: '6px', background: '#89b4fa', color: '#111', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                ⏭️ Redo
            </button>
            <button onClick={handleExport} style={{ padding: '6px', background: '#a6e3a1', color: '#111', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                💾 Export CSV
            </button>
        </div>

        <div style={{ marginBottom: 12, fontSize: 12, color: '#f9e2af' }}>{lastStatus}</div>
        
        {scans.map((s, i) => (
          <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid #313244' }}>
            <div style={{ fontWeight: 'bold', wordBreak: 'break-all' }}>{s.barcode}</div>
            <div style={{ fontSize: 11, color: '#a6adc8' }}>{s.time}</div>
          </div>
        ))}
      </div>

      {/* ── Main Area ── */}
      <div style={{ flex: 1, padding: 24, overflowY: 'auto', background: '#f8f8f2', color: '#333' }}>
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ margin: 0, marginBottom: '12px' }}>📊 Offline Barcode Excel DB</h2>
          
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '12px', background: '#fff', padding: '12px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              <label style={{ fontSize: 12, color: '#555', display: 'flex', flexDirection: 'column' }}>
                Excel File Path:
                <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                  <input
                    readOnly
                    value={filePath}
                    style={{ width: 200, padding: '4px', background: '#f0f0f0', border: '1px solid #ccc' }}
                  />
                  <button onClick={handleSelectFile} style={{ padding: '4px 8px', cursor: 'pointer', background: '#89b4fa', border: 'none', borderRadius: '4px', color: '#111' }}>
                    Browse...
                  </button>
                </div>
              </label>

              <label style={{ fontSize: 12, color: '#555', display: 'flex', flexDirection: 'column' }}>
                Active Sheet:
                <div style={{display: 'flex', marginTop: '4px'}}>
                    <select value={sheetName} onChange={(e) => setSheetName(e.target.value)} style={{ padding: '4px', background: '#fff', border: '1px solid #ccc' }}>
                        {availableSheets.map(sn => <option key={sn} value={sn}>{sn}</option>)}
                    </select>
                    <input 
                       placeholder="New sheet name & Enter"
                       onKeyDown={(e) => {
                           if(e.key === 'Enter' && e.target.value.trim()) {
                             const newSheet = e.target.value.trim();
                             setSheetName(newSheet);
                             if (!availableSheets.includes(newSheet)) {
                                 setAvailableSheets(prev => [...prev, newSheet]);
                             }
                             e.target.value = '';
                           }
                       }}
                       style={{marginLeft: '8px', padding: '4px', border: '1px solid #ccc'}}
                    />
                </div>
              </label>
          </div>

          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px', background: '#fff', padding: '12px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              <label style={{ fontSize: 12, color: '#555', display: 'flex', flexDirection: 'column' }}>
                Barcode Column:
                <input value={barcodeColName} onChange={(e) => setBarcodeColName(e.target.value)} style={{ padding: '4px' }} />
              </label>
              <label style={{ fontSize: 12, color: '#555', display: 'flex', flexDirection: 'column' }}>
                Quantity Column:
                <input value={quantityColName} onChange={(e) => setQuantityColName(e.target.value)} style={{ padding: '4px' }} />
              </label>
              <label style={{ fontSize: 12, color: '#555', display: 'flex', flexDirection: 'column' }}>
                Timestamp Column:
                <input value={timestampColName} onChange={(e) => setTimestampColName(e.target.value)} style={{ padding: '4px' }} />
              </label>
          </div>
          <p style={{fontSize: 12, color: '#777'}}><em>Focus anywhere (not in an input field) and scan a barcode to insert/update data.</em></p>
        </div>

        {rows.length === 0 ? (
          <p style={{ color: '#888' }}>No data yet. Start scanning to populate the table.</p>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%', background: '#fff' }}>
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
