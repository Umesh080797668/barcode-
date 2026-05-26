import { useState, useEffect, useRef, useCallback } from 'react';
import { formatCurrency, formatNumber } from './utils/format';
import './App.css';
import ScanVaultTutorial from './ScanVaultTutorial';
import BarcodeGenerator from './BarcodeGenerator';
import BillingModule from './BillingModule';

export default function App() {
  const UPDATE_REPO = 'Umesh080797668/barcode-';
  const [filePath, setFilePath] = useState('');
  const [sheetName, setSheetName] = useState('Sheet1');
  const [availableSheets, setAvailableSheets] = useState(['Sheet1']);
  const [scans, setScans] = useState([]);
  const [rows, setRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [lastStatus, setStatus] = useState('idle');
  const [statusMsg, setStatusMsg] = useState('Ready to scan');
  const [activeTab, setActiveTab] = useState('data');
  const [searchQuery, setSearchQuery] = useState('');
  const [scanFlash, setScanFlash] = useState(null);
  const [totalScansToday, setTotalScansToday] = useState(0);
  const [uniqueItems, setUniqueItems] = useState(0);
  const [productsCount, setProductsCount] = useState(0);
  const [newSheetInput, setNewSheetInput] = useState('');
  const [showNewSheetInput, setShowNewSheetInput] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [inventoryAddMode, setInventoryAddMode] = useState('inventory_only');
  const [lastScanPopup, setLastScanPopup] = useState(null);
  const [appVersion, setAppVersion] = useState('0.0.0');
  const [updateStatus, setUpdateStatus] = useState('Idle');
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);

  const [barcodeColName] = useState('Barcode');
  const [quantityColName] = useState('Quantity');
  const [timestampColName] = useState('Last Scanned');

  // Unified Columns List (Defaults + Extras for ordering)
  const [columnsList, setColumnsList] = useState([
    { id: 'barcode', name: 'Barcode', isDefault: true, defaultValue: '' },
    { id: 'name',    name: 'Name',    isDefault: true, defaultValue: '' },
    { id: 'quantity', name: 'Quantity', isDefault: true, defaultValue: '' },
    { id: 'price',   name: 'Price',   isDefault: true, defaultValue: '' },
    { id: 'timestamp', name: 'Last Scanned', isDefault: true, defaultValue: '' }
  ]);

  const barcodeBuffer = useRef('');
  const bufferTimer = useRef(null);
  const statusTimer = useRef(null);
  const popupTimer = useRef(null);
  const tableBodyRef = useRef(null);

  useEffect(() => {
    if (window.electronAPI?.getAppVersion) {
      window.electronAPI.getAppVersion().then((result) => {
        if (result?.success && result.version) setAppVersion(result.version);
      });
    }
  }, []);

  const showLastScanPopup = useCallback((entry) => {
    if (activeTab !== 'data') return;
    setLastScanPopup(entry);
    clearTimeout(popupTimer.current);
    popupTimer.current = setTimeout(() => setLastScanPopup(null), 3000);
  }, [activeTab]);

  const setTempStatus = (type, msg) => {
    setStatus(type);
    setStatusMsg(msg);
    setScanFlash(type);
    clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => {
      setScanFlash(null);
      setStatus('idle');
      setStatusMsg('Ready to scan');
    }, 2500);
  };

  const loadData = useCallback(() => {
    if (!window.electronAPI || !filePath) return;
    window.electronAPI.readExcel(filePath, sheetName).then((result) => {
      if (result.success) {
        setHeaders(result.headers || []);
        setRows(result.rows || []);
        setAvailableSheets(result.sheetNames || ['Sheet1']);
        setUniqueItems(result.rows?.length || 0);
        if (result.sheetNames && !result.sheetNames.includes(sheetName)) {
          setSheetName(result.sheetNames[0] || 'Sheet1');
        }
      } else {
        setTempStatus('error', result.error || 'Failed to read file');
      }
    });
  }, [filePath, sheetName]);

  useEffect(() => { loadData(); }, [loadData]);

  // Keep product count in sync when product DB changes (barcode creator)
  useEffect(() => {
    const onProductsChanged = async () => {
      if (!window.electronAPI) return;
      try {
        const r = await window.electronAPI.getProducts();
        if (r && r.success) setProductsCount((r.products || []).length);
        if (filePath) loadData();
      } catch { /* ignore */ }
    };
    window.addEventListener('products:changed', onProductsChanged);
    // initial
    onProductsChanged();
    return () => window.removeEventListener('products:changed', onProductsChanged);
  }, [filePath, loadData]);

  async function processBarcode(barcode, source = 'scan') {
    if (!window.electronAPI) {
      const existing = rows.find(r => String(r[barcodeColName]) === String(barcode));
      const now = new Date().toLocaleString();
      let newRows;
      let isDuplicate = false;
      if (existing) {
        newRows = rows.map(r => String(r[barcodeColName]) === String(barcode)
          ? { ...r, [quantityColName]: (r[quantityColName] || 0) + 1, [timestampColName]: now }
          : r);
        isDuplicate = true;
      } else {
        newRows = [...rows, { [barcodeColName]: barcode, [quantityColName]: 1, [timestampColName]: now }];
        if (headers.length === 0) setHeaders([barcodeColName, quantityColName, timestampColName]);
      }
      setRows(newRows);
      setUniqueItems(newRows.length);
      const entry = { barcode, time: new Date().toLocaleTimeString(), isDuplicate, source };
      setScans(prev => [entry, ...prev.slice(0, 99)]);
      showLastScanPopup(entry);
      setTotalScansToday(p => p + 1);
      setTempStatus(isDuplicate ? 'duplicate' : 'success', isDuplicate ? `+1 qty: ${barcode}` : `New item: ${barcode}`);
      return;
    }

    if (!filePath) {
      setTempStatus('error', 'Select an Excel file first');
      return;
    }

    const result = await window.electronAPI.updateExcel({
      filePath, barcode,
      columnConfig: {
        barcodeColumn: barcodeColName,
        quantityColumn: quantityColName,
        timestampColumn: timestampColName,
        columnsOrder: columnsList.map(c => c.name).filter(n => n.trim()),
        extraColumns: columnsList.filter(c => !c.isDefault)
      },
      sheetName
    });

    if (result.success) {
      if (result.headers && result.headers.length > 0) {
        setHeaders(result.headers);
      } else {
        setHeaders(result.rows[0] ? Object.keys(result.rows[0]) : headers);
      }
      setRows(result.rows);
      setUniqueItems(result.rows.length);
      setAvailableSheets(result.sheetNames || availableSheets);
      const entry = { barcode, time: new Date().toLocaleTimeString(), isDuplicate: result.isDuplicate, source };
      setScans(prev => [entry, ...prev.slice(0, 99)]);
      showLastScanPopup(entry);
      setTotalScansToday(p => p + 1);
      setTempStatus(result.isDuplicate ? 'duplicate' : 'success',
        result.isDuplicate ? `+1 qty: ${barcode}` : `New item: ${barcode}`);

      const row = (result.rows || []).find(r => String(r[barcodeColName]) === String(barcode)) || null;
      if (row) {
        const currentProduct = await window.electronAPI.getProduct(barcode);
        const payload = {
          barcode,
          name: row.Name ?? row.name ?? currentProduct?.product?.name ?? null,
          price: row.Price ?? row.price ?? currentProduct?.product?.price ?? 0,
          quantity: Number(row[quantityColName] ?? row.Quantity ?? currentProduct?.product?.quantity ?? 0),
          scan_mode: inventoryAddMode,
          sku: currentProduct?.product?.sku ?? row.sku ?? null,
          category: currentProduct?.product?.category ?? row.category ?? null,
          custom_fields: currentProduct?.product?.custom_fields ?? {},
        };
        await window.electronAPI.syncProduct(payload);
      }
    } else {
      setTempStatus('error', result.error || 'Update failed');
    }
  }

  const handleScannedBarcode = async (barcode, source = 'scan') => {
    if (!window.electronAPI) {
      await processBarcode(barcode, source);
      return;
    }

    if (activeTab === 'billing' || inventoryAddMode === 'normal') {
      if (activeTab !== 'billing') {
        setActiveTab('billing');
      }
      window.postMessage({ action: 'billing:scan', barcode }, '*');
      return;
    }

    await processBarcode(barcode, source);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (e.key === 'Enter') {
        const barcode = barcodeBuffer.current;
        barcodeBuffer.current = '';
        clearTimeout(bufferTimer.current);
        if (barcode.trim().length > 2) {
          void handleScannedBarcode(barcode, 'scan');
        }
      } else if (e.key.length === 1) {
        barcodeBuffer.current += e.key;
        clearTimeout(bufferTimer.current);
        bufferTimer.current = setTimeout(() => { barcodeBuffer.current = ''; }, 100);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  useEffect(() => () => clearTimeout(popupTimer.current), []);

  const handleSelectFile = async () => {
    if (!window.electronAPI) return;
    const p = await window.electronAPI.selectFile();
    if (p) { setFilePath(p); setTempStatus('success', 'File loaded'); }
  };

  const handleUndo = async () => {
    if (!window.electronAPI) return;
    const r = await window.electronAPI.undoScan(filePath);
    if (r.success) { setHeaders(r.headers || []); setRows(r.rows || []); setScans(p => p.slice(1)); setTempStatus('idle', 'Undo complete'); }
    else setTempStatus('error', r.error);
  };

  const handleRedo = async () => {
    if (!window.electronAPI) return;
    const r = await window.electronAPI.redoScan(filePath);
    if (r.success) { setHeaders(r.headers || []); setRows(r.rows || []); setTempStatus('idle', 'Redo complete'); }
    else setTempStatus('error', r.error);
  };

  const handleExport = async () => {
    if (!window.electronAPI) return;
    const r = await window.electronAPI.exportCSV(filePath);
    if (r.success) setTempStatus('success', `Exported: ${r.filePath.split(/[\\/]/).pop()}`);
    else setTempStatus('error', r.error || 'Export cancelled');
  };

  const checkForUpdates = async () => {
    const repo = UPDATE_REPO.trim();
    if (!repo) {
      setUpdateStatus('Update source is not configured');
      return;
    }

    setUpdateBusy(true);
    setUpdateStatus('Checking GitHub releases...');
    setUpdateInfo(null);

    try {
      const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json' },
      });

      if (!response.ok) {
        throw new Error(`GitHub returned ${response.status}`);
      }

      const release = await response.json();
      const asset = (release.assets || []).find((item) => /\.(exe|AppImage)$/i.test(item.name) && !/blockmap/i.test(item.name))
        || (release.assets || []).find((item) => !/blockmap/i.test(item.name));
      const currentVersion = String(appVersion || '').replace(/^v/i, '');
      const latestVersion = String(release.tag_name || '').replace(/^v/i, '');
      const isUpToDate = currentVersion && latestVersion && currentVersion === latestVersion;

      const info = {
        tag: release.tag_name || '',
        name: release.name || release.tag_name || 'Latest release',
        body: release.body || '',
        assetName: asset?.name || '',
        assetUrl: asset?.browser_download_url || '',
        currentVersion,
        latestVersion,
        publishedAt: release.published_at || '',
        updateAvailable: !isUpToDate,
      };

      setUpdateInfo(info);
      setUpdateStatus(isUpToDate ? 'You are on the latest version' : `Update available: ${info.latestVersion || info.tag}`);
    } catch (error) {
      setUpdateStatus(error.message || 'Unable to check updates');
    } finally {
      setUpdateBusy(false);
    }
  };

  const downloadAndInstallUpdate = async () => {
    if (!window.electronAPI || !updateInfo?.assetUrl) {
      setUpdateStatus('No downloadable update found');
      return;
    }

    setUpdateBusy(true);
    setUpdateStatus('Downloading update...');

    try {
      const result = await window.electronAPI.downloadAndInstallUpdate({
        url: updateInfo.assetUrl,
        filename: updateInfo.assetName,
      });

      if (result.success) {
        setUpdateStatus(result.launched
          ? 'Installer launched. Follow the setup wizard.'
          : `Downloaded to ${result.downloadedPath}`);
      } else {
        setUpdateStatus(result.error || 'Download failed');
      }
    } finally {
      setUpdateBusy(false);
    }
  };

  const handleManualScan = () => {
    const val = manualInput;
    if (val.trim().length > 0) { void handleScannedBarcode(val, 'manual'); setManualInput(''); }
  };

  const filteredRows = rows.filter(row =>
    headers.some(h => String(row[h] ?? '').toLowerCase().includes(searchQuery.toLowerCase()))
  );

  useEffect(() => {
    if (activeTab !== 'data') return;
    const latestBarcode = scans[0]?.barcode;
    if (!latestBarcode || !tableBodyRef.current || filteredRows.length === 0) return;

    const targetIndex = filteredRows.findIndex(
      row => String(row[barcodeColName]) === String(latestBarcode)
    );
    if (targetIndex < 0) return;

    const targetRow = tableBodyRef.current.children[targetIndex];
    if (targetRow && typeof targetRow.scrollIntoView === 'function') {
      targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeTab, scans, filteredRows, barcodeColName]);

  const statusColors = { success: 'var(--green)', duplicate: 'var(--amber)', error: 'var(--red)', idle: 'var(--muted)' };
  const statusLabels = { success: 'Updated', duplicate: 'Qty +1', error: 'Error', idle: 'Ready' };

  const applyReorderToExcel = async (newCols) => {
    if (!window.electronAPI || !filePath) return;
    const orderedNames = newCols.map(c => c.name).filter(n => n.trim());
    
    // Fill missing defaults in the current rows before rewriting
    const updatedRows = rows.map(r => {
        const newRow = { ...r };
        newCols.filter(c => !c.isDefault).forEach(c => {
            if (c.name && newRow[c.name] === undefined) {
               newRow[c.name] = c.defaultValue || '';
            }
        });
        return newRow;
    });

    const result = await window.electronAPI.rewriteExcel({
      filePath, 
      sheetName, 
      rows: updatedRows,
      columnsOrder: orderedNames
    });

    if (result.success) {
      setRows(updatedRows);
      // Let the sheet know about the structural change
      window.electronAPI.readExcel(filePath, sheetName).then((res) => {
         if (res.success) {
            setHeaders(res.headers || []);
         }
      });
      setTempStatus('success', 'Columns synchronized with Excel');
    } else {
      setTempStatus('error', result.error || 'Failed to sync columns');
    }
  };

  const orderedNames = columnsList.map(c => c.name).filter(n => n.trim());
  const allHeadersSet = new Set(orderedNames);
  headers.forEach(h => allHeadersSet.add(h));
  const displayHeaders = Array.from(allHeadersSet).filter(h => h !== 'Scan Mode' && h !== 'scan_mode');

  return (
    <div className={`app-shell ${scanFlash ? `flash-${scanFlash}` : ''}`}>
      {lastScanPopup && (
        <div className="last-scan-popup" role="status" aria-live="polite">
          <div className="last-scan-title">Last {lastScanPopup.source === 'manual' ? 'Entered' : 'Scanned'}</div>
          <div className="last-scan-code">{lastScanPopup.barcode}</div>
        </div>
      )}
      <ScanVaultTutorial />
      {/* Top Bar */}
      <header className="topbar">
        <div className="topbar-brand">
          <div className="brand-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <rect x="2" y="3" width="2.5" height="18" rx="0.5" fill="currentColor"/>
              <rect x="5.5" y="3" width="1" height="18" rx="0.5" fill="currentColor"/>
              <rect x="7.5" y="3" width="2" height="18" rx="0.5" fill="currentColor"/>
              <rect x="10.5" y="3" width="1" height="18" rx="0.5" fill="currentColor"/>
              <rect x="12.5" y="3" width="3" height="18" rx="0.5" fill="currentColor"/>
              <rect x="16.5" y="3" width="1" height="18" rx="0.5" fill="currentColor"/>
              <rect x="18.5" y="3" width="3" height="18" rx="0.5" fill="currentColor"/>
            </svg>
          </div>
          <span className="brand-name">ScanVault</span>
          <span className="brand-tag">Offline</span>
        </div>

        <div className="topbar-center">
          <div className="status-pill" style={{ '--s-color': statusColors[lastStatus] }}>
            <span className="status-dot"></span>
            <span className="status-label">{statusLabels[lastStatus]}</span>
            <span className="status-sep">·</span>
            <span className="status-msg">{statusMsg}</span>
          </div>
        </div>

        <div className="topbar-actions">
          <button className="btn-ghost" onClick={handleUndo} title="Undo last scan">
            <IconUndo /> Undo
          </button>
          <button className="btn-ghost" onClick={handleRedo} title="Redo">
            <IconRedo /> Redo
          </button>
          <div className="divider-v"></div>
          <button className="btn-accent" onClick={handleExport}>
            <IconDownload /> Export CSV
          </button>
        </div>
      </header>

      <div className="app-body">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-inner">
            {/* File Picker */}
            <section className="sidebar-section">
              <span className="section-label">Source File</span>
              <div className="file-card">
                <div className="file-icon">
                  <IconFile />
                </div>
                <div className="file-info">
                  <div className="file-name">{filePath ? filePath.split(/[\\/]/).pop() : 'No file selected'}</div>
                  {filePath && <div className="file-path">{filePath}</div>}
                </div>
                <button className="btn-browse" onClick={handleSelectFile}>Browse</button>
              </div>
            </section>

            {activeTab === 'data' && (
              <section className="sidebar-section inventory-mode-section">
                <span className="section-label">Inventory Mode</span>
                <div className="inventory-mode-card">
                  <div className="mode-toggle-row">
                    <button
                      className={`mode-chip ${inventoryAddMode === 'inventory_only' ? 'active' : ''}`}
                      onClick={() => setInventoryAddMode('inventory_only')}
                      type="button"
                    >
                      <span className="mode-chip-title">Inventory only</span>
                      <span className="mode-chip-sub">Scan updates stock</span>
                    </button>
                    <button
                      className={`mode-chip ${inventoryAddMode === 'normal' ? 'active' : ''}`}
                      onClick={() => setInventoryAddMode('normal')}
                      type="button"
                    >
                      <span className="mode-chip-title">Normal</span>
                      <span className="mode-chip-sub">Scan adds to billing</span>
                    </button>
                  </div>
                  <div className="field-hint">
                    Selected mode controls how the next scan behaves.
                  </div>
                </div>
              </section>
            )}

            {/* Sheet Selector */}
            {availableSheets.length > 0 && (
              <section className="sidebar-section">
                <span className="section-label">Active Sheet</span>
                <div className="sheet-row">
                  {availableSheets.map(sn => (
                    <button key={sn} className={`sheet-chip ${sheetName === sn ? 'active' : ''}`} onClick={() => setSheetName(sn)}>{sn}</button>
                  ))}
                  <button className="sheet-chip sheet-add" onClick={() => setShowNewSheetInput(v => !v)}>+</button>
                </div>
                {showNewSheetInput && (
                  <input className="input-sm" placeholder="New sheet name + Enter" value={newSheetInput}
                    autoFocus onChange={e => setNewSheetInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && newSheetInput.trim()) {
                        const ns = newSheetInput.trim();
                        if (!availableSheets.includes(ns)) setAvailableSheets(p => [...p, ns]);
                        setSheetName(ns); setNewSheetInput(''); setShowNewSheetInput(false);
                      }
                    }}
                  />
                )}
              </section>
            )}

            {/* Manual Entry */}
            <section className="sidebar-section">
              <span className="section-label">Manual Entry</span>
              <div className="manual-row">
                <input className="input-sm" placeholder="Type barcode, press Enter" value={manualInput}
                  onChange={e => setManualInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleManualScan(); }} />
                <button className="btn-go" onClick={handleManualScan}><IconEnter /></button>
              </div>
            </section>

            {/* Stats */}
            <section className="sidebar-section">
              <span className="section-label">Session Stats</span>
              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-value">{formatNumber(totalScansToday, { maximumFractionDigits: 0 })}</div>
                  <div className="stat-label">Scans</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{formatNumber(uniqueItems, { maximumFractionDigits: 0 })}</div>
                  <div className="stat-label">Items</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{formatNumber(scans.filter(s => s.isDuplicate).length, { maximumFractionDigits: 0 })}</div>
                  <div className="stat-label">Updates</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{formatNumber(rows.reduce((a, r) => a + (Number(r[quantityColName]) || 0), 0), { maximumFractionDigits: 0 })}</div>
                  <div className="stat-label">Total Qty</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{formatNumber(productsCount, { maximumFractionDigits: 0 })}</div>
                  <div className="stat-label">Products</div>
                </div>
              </div>
            </section>

            {/* Scan Feed */}
            <section className="sidebar-section sidebar-feed">
              <span className="section-label">Scan History</span>
              <div className="scan-feed">
                {scans.length === 0 ? (
                  <div className="feed-empty">
                    <div className="feed-empty-icon"><IconBarcode /></div>
                    <div>Scans appear here</div>
                  </div>
                ) : scans.map((s, i) => (
                  <div key={i} className={`scan-item ${s.isDuplicate ? 'dup' : 'new'} ${i === 0 ? 'latest' : ''}`}>
                    <span className={`scan-badge ${s.isDuplicate ? 'badge-dup' : 'badge-new'}`}>{s.isDuplicate ? '+1' : 'NEW'}</span>
                    <div className="scan-detail">
                      <div className="scan-code">{s.barcode}</div>
                      <div className="scan-ts">{s.time}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </aside>

        {/* Main Panel */}
        <main className="main-panel">
          <div className="tab-bar">
            <div className="tabs">
              <button className={`tab ${activeTab === 'data' ? 'tab-on' : ''}`} onClick={() => setActiveTab('data')}>
                <IconTable /> Inventory
              </button>
              <button className={`tab ${activeTab === 'barcode' ? 'tab-on' : ''}`} onClick={() => setActiveTab('barcode')}>
                <IconBarcode /> Barcode Creator
              </button>
              <button className={`tab ${activeTab === 'billing' ? 'tab-on' : ''}`} onClick={() => setActiveTab('billing')}>
  <IconPrinter /> Billing
</button>
              <button className={`tab ${activeTab === 'settings' ? 'tab-on' : ''}`} onClick={() => setActiveTab('settings')}>
                <IconSettings /> Settings
              </button>
            </div>
            {activeTab === 'data' && rows.length > 0 && (
              <div className="tab-right">
                <div className="search-box">
                  <IconSearch />
                  <input className="search-input" placeholder="Filter rows…" value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)} />
                  {searchQuery && <button className="search-clear" onClick={() => setSearchQuery('')}>×</button>}
                </div>
                <span className="row-count">{filteredRows.length} of {rows.length}</span>
              </div>
            )}
          </div>

{activeTab === 'billing' ? (
  <BillingModule 
    filePath={filePath}
    sheetName={sheetName}
    columnConfig={{ barcodeColumn: barcodeColName, quantityColumn: quantityColName, timestampColumn: timestampColName, columnsOrder: orderedNames }}
  />
) : activeTab === 'barcode' ? (
          <BarcodeGenerator filePath={filePath} sheetName={sheetName} columnConfig={{
            barcodeColumn: barcodeColName,
            quantityColumn: quantityColName,
            timestampColumn: timestampColName,
            columnsOrder: columnsList.map(c => c.name).filter(n => n.trim()),
            extraColumns: columnsList.filter(c => !c.isDefault)
          }} />
) : activeTab === 'data' ? (
  <div className="table-wrap">
    {searchQuery && filteredRows.length === 0 ? (
                <div className="empty-state">
                  <h2 className="empty-h">No results found</h2>
                  <p className="empty-p">No records match "{searchQuery}"</p>
                </div>
              ) : rows.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-art">
                    {[3,7,11,13,17,19,22,26,29,31,35,38,41].map((x, i) => (
                      <div key={i} className="empty-bar" style={{ left: x, height: 40 + (i % 4) * 12, opacity: 0.12 + (i % 3) * 0.1 }}></div>
                    ))}
                  </div>
                  <h2 className="empty-h">No inventory yet</h2>
                  <p className="empty-p">
                    {filePath ? 'Aim the scanner and fire — data appears instantly.' : 'Select your Excel file, then start scanning.'}
                  </p>
                  {!filePath && (
                    <button className="btn-accent btn-lg" onClick={handleSelectFile}>
                      <IconFile /> Select Excel File
                    </button>
                  )}
                </div>
              ) : (
                  <table className="data-table">
                  <thead>
                    <tr>
                      <th className="th-num">#</th>
                      {displayHeaders.map(h => <th key={h}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody ref={tableBodyRef}>
                    {filteredRows.map((row, i) => {
                      const isLatest = scans[0]?.barcode === String(row[barcodeColName]);
                      return (
                        <tr key={i} className={isLatest ? 'row-fresh' : ''}>
                          <td className="td-num">{i + 1}</td>
                          {displayHeaders.map(h => (
                            <td key={h} className={
                              h === barcodeColName ? 'td-code' :
                              h === quantityColName ? 'td-qty' : ''
                            }>
                              {h === quantityColName ? (
                                <span className="qty-badge">{String(row[h] ?? '')}</span>
                              ) : h === 'Price' ? (
                                `Rs. ${formatCurrency(row[h] || 0)}`
                              ) : (
                                String(row[h] ?? '')
                              )}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          ) : (
            <div className="settings-panel">
              <div className="settings-block">
                <h3 className="settings-h">Columns Configuration</h3>
                <p className="settings-p">Rearrange the order of any column. Default 3 columns cannot be renamed or deleted.</p>
                
                <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                  <button className="btn-ghost" onClick={() => setColumnsList([...columnsList, { id: Date.now(), name: '', isDefault: false, defaultValue: '' }])}>
                    + Add Extra Column
                  </button>
                </div>

                {columnsList.map((col, idx) => (
                  <div key={col.id} style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center' }}>
                    <button 
                      className="btn-ghost" 
                      style={{ padding: '4px', cursor: idx === 0 ? 'not-allowed' : 'pointer', opacity: idx === 0 ? 0.3 : 1 }} 
                      disabled={idx === 0}
                      onClick={() => {
                        const newCols = [...columnsList];
                        const t = newCols[idx - 1];
                        newCols[idx - 1] = newCols[idx];
                        newCols[idx] = t;
                        setColumnsList(newCols);
                        if (filePath) applyReorderToExcel(newCols);
                      }}
                    >↑</button>
                    <button 
                      className="btn-ghost" 
                      style={{ padding: '4px', cursor: idx === columnsList.length - 1 ? 'not-allowed' : 'pointer', opacity: idx === columnsList.length - 1 ? 0.3 : 1 }} 
                      disabled={idx === columnsList.length - 1}
                      onClick={() => {
                        const newCols = [...columnsList];
                        const t = newCols[idx + 1];
                        newCols[idx + 1] = newCols[idx];
                        newCols[idx] = t;
                        setColumnsList(newCols);
                        if (filePath) applyReorderToExcel(newCols);
                      }}
                    >↓</button>

                    <input 
                      placeholder="Column Name" 
                      className="field-input" 
                      value={col.name} 
                      disabled={col.isDefault}
                      onChange={e => {
                        if (col.isDefault) return;
                        const newCols = [...columnsList];
                        newCols[idx].name = e.target.value;
                        setColumnsList(newCols);
                      }} 
                      onBlur={() => {
                        if (!col.isDefault && filePath) applyReorderToExcel(columnsList);
                      }}
                      style={{ opacity: col.isDefault ? 0.7 : 1, width: '200px' }}
                    />
                    
                    {!col.isDefault ? (
                      <input 
                        placeholder="Default Value" 
                        className="field-input" 
                        value={col.defaultValue} 
                        onChange={e => {
                          const newCols = [...columnsList];
                          newCols[idx].defaultValue = e.target.value;
                          setColumnsList(newCols);
                        }} 
                        onBlur={() => {
                           if (filePath) applyReorderToExcel(columnsList);
                        }}
                        style={{ width: '200px' }}
                      />
                    ) : (
                      <div className="field-input" style={{ width: '200px', opacity: 0.5, display: 'flex', alignItems: 'center', background: 'transparent', border: 'none', paddingLeft: 0 }}>
                        (Core Data)
                      </div>
                    )}

                    <button 
                      className="btn-ghost" 
                      style={{ padding: '0 8px', color: col.isDefault ? 'transparent' : 'var(--red)', pointerEvents: col.isDefault ? 'none' : 'auto' }} 
                      onClick={() => {
                        if (col.isDefault) return;
                        const newCols = columnsList.filter((_, i) => i !== idx);
                        setColumnsList(newCols);
                        if (filePath) applyReorderToExcel(newCols);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>

              <div className="settings-block">
                <h3 className="settings-h">How It Works</h3>
                <div className="info-grid">
                  <InfoCard icon="⌨" title="HID Keyboard Mode" body="USB or Bluetooth scanners type the barcode then press Enter. No drivers needed." />
                  <InfoCard icon="⚡" title="100ms Buffer" body="Characters arriving within 100ms are treated as a scan. Slower keyboard input is ignored." />
                  <InfoCard icon="📄" title="Local Excel Only" body="Reads and writes .xlsx files directly on disk. No internet, no sync, no cloud." />
                  <InfoCard icon="↩" title="Undo / Redo" body="Up to 10 steps of scan history. Reverse any mistake without reopening Excel." />
                </div>
              </div>

              <div className="settings-block">
                <h3 className="settings-h">Update Center</h3>
                <div className="update-current-version">Current Version: {appVersion || 'Unknown'}</div>

                <div className="update-actions">
                  <button className="btn-ghost" onClick={checkForUpdates} disabled={updateBusy}>
                    <IconRefresh /> Check for Update
                  </button>
                  <button className="btn-accent" onClick={downloadAndInstallUpdate} disabled={updateBusy || !updateInfo?.assetUrl}>
                    <IconDownload /> Download & Install
                  </button>
                </div>

                <div className="update-status">{updateStatus}</div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function InfoCard({ icon, title, body }) {
  return (
    <div className="info-card">
      <div className="info-icon">{icon}</div>
      <div className="info-title">{title}</div>
      <div className="info-body">{body}</div>
    </div>
  );
}

// Icons
const IconUndo = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13"/></svg>;
const IconRedo = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 019-9 9 9 0 016 2.3L21 13"/></svg>;
const IconDownload = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
const IconRefresh = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15A9 9 0 106 6.51L1 11m23 9l-5-5"/></svg>;
const IconFile = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
const IconEnter = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 01-4 4H4"/></svg>;
const IconTable = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>;
const IconSettings = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>;
const IconSearch = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
const IconBarcode = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="2" height="16" rx="0.5"/><rect x="5" y="4" width="1" height="16" rx="0.5"/><rect x="7" y="4" width="2" height="16" rx="0.5"/><rect x="11" y="4" width="1" height="16" rx="0.5"/><rect x="13" y="4" width="3" height="16" rx="0.5"/><rect x="17" y="4" width="1" height="16" rx="0.5"/><rect x="19" y="4" width="3" height="16" rx="0.5"/></svg>;
const IconPrinter = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z"/></svg>;