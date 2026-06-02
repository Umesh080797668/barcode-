import { lazy, Suspense, startTransition, useDeferredValue, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { formatCurrency, formatNumber } from './utils/format';
import './App.css';
import ScanVaultTutorial from './ScanVaultTutorial';

const BarcodeGenerator = lazy(() => import('./BarcodeGenerator'));
const BillingModule = lazy(() => import('./BillingModule'));

export default function App() {
  const UPDATE_REPO = 'Umesh080797668/barcode-';
  const UPDATE_SKIP_KEY = 'scanvault_update_skip_version_v1';

  // ── State ────────────────────────────────────────────────────────────────
  const [scans, setScans]                     = useState([]);
  const [rows, setRows]                       = useState([]);
  const [headers, setHeaders]                 = useState([]);
  const [lastStatus, setStatus]               = useState('idle');
  const [statusMsg, setStatusMsg]             = useState('Ready to scan');
  const [activeTab, setActiveTab]             = useState('data');
  const [searchQuery, setSearchQuery]         = useState('');
  const [scanFlash, setScanFlash]             = useState(null);
  const [totalScansToday, setTotalScansToday] = useState(0);
  const [uniqueItems, setUniqueItems]         = useState(0);
  const [productsCount, setProductsCount]     = useState(0);
  const [manualInput, setManualInput]         = useState('');
  const [inventoryAddMode, setInventoryAddMode] = useState('inventory_only');
  const [lastScanPopup, setLastScanPopup]     = useState(null);
  const [inventoryPage, setInventoryPage]     = useState(1);
  const [inventoryScrollTop, setInventoryScrollTop] = useState(0);
  const [inventoryViewportHeight, setInventoryViewportHeight] = useState(0);
  const [appVersion, setAppVersion]           = useState('');
  const [updateStatus, setUpdateStatus]       = useState('Idle');
  const [updateBusy, setUpdateBusy]           = useState(false);
  const [updateInfo, setUpdateInfo]           = useState(null);
  const [isOnline, setIsOnline]               = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);
  const [backupProgress, setBackupProgress]   = useState(null);
  const [csvExportPath, setCsvExportPath]     = useState(null);
  const [backupScheduleInfo, setBackupScheduleInfo] = useState(null);
  const [lastAutoBackup, setLastAutoBackup]   = useState(null);

  const barcodeColName   = 'Barcode';
  const quantityColName  = 'Quantity';
  const timestampColName = 'Last Scanned';

  const barcodeBuffer = useRef('');
  const bufferTimer   = useRef(null);
  const statusTimer   = useRef(null);
  const popupTimer    = useRef(null);
  const tableBodyRef  = useRef(null);
  const tableWrapRef  = useRef(null);
  const rowsRef       = useRef([]);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const toInventoryRow = useCallback((product) => {
    const row = {
      [barcodeColName]:  product?.barcode || '',
      Name:              product?.name || '',
      SKU:               product?.sku || '',
      Price:             product?.price ?? 0,
      [quantityColName]:  product?.quantity ?? 0,
      Category:          product?.category || '',
      [timestampColName]: product?.updated_at || product?.created_at || '',
    };

    for (const [key, value] of Object.entries(product?.custom_fields || {})) {
      row[key] = value ?? '';
    }

    row.__searchText = Object.values(row)
      .map(value => String(value ?? ''))
      .join(' ')
      .toLowerCase();

    return row;
  }, []);

  const applyInventoryRow = useCallback((product, { createIfMissing = false } = {}) => {
    const nextRow = toInventoryRow(product);
    if (!nextRow[barcodeColName]) return;

    startTransition(() => {
      setRows(prev => {
        const index = prev.findIndex(row => String(row[barcodeColName]) === String(nextRow[barcodeColName]));
        if (index >= 0) {
          const next = prev.slice();
          next[index] = { ...next[index], ...nextRow };
          return next;
        }
        if (createIfMissing || prev.length === 0) return [...prev, nextRow];
        return prev;
      });

      if (createIfMissing) {
        setUniqueItems(count => count + 1);
        setProductsCount(count => count + 1);
      }
    });
  }, [toInventoryRow]);

  const setTempStatus = useCallback((type, msg) => {
    setStatus(type);
    setStatusMsg(msg);
    setScanFlash(type);
    clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => {
      setScanFlash(null);
      setStatus('idle');
      setStatusMsg('Ready to scan');
    }, 2500);
  }, []);

  // ── App version ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (window.electronAPI?.getAppVersion) {
      window.electronAPI.getAppVersion().then((result) => {
        if (result?.success && result.version) setAppVersion(result.version);
      });
    }
  }, []);

  // ── Online detection ─────────────────────────────────────────────────────
  useEffect(() => {
    const handleOnline  = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // ── Backup progress listener ─────────────────────────────────────────────
  useEffect(() => {
    if (!window.electronAPI?.onBackupProgress) return undefined;
    return window.electronAPI.onBackupProgress((payload) => {
      if (!payload?.operation) return;
      setBackupProgress({
        operation: payload.operation,
        status:    payload.status || 'running',
        phase:     payload.phase  || '',
        progress:  typeof payload.progress === 'number' ? payload.progress : null,
        details:   payload.details || '',
        updatedAt: Date.now(),
      });
    });
  }, []);

  // ── Auto backup notification ─────────────────────────────────────────────
  useEffect(() => {
    if (!window.electronAPI?.onAutoBackupComplete) return undefined;
    return window.electronAPI.onAutoBackupComplete((payload) => {
      setLastAutoBackup(payload);
      setTempStatus('success', 'Auto-backup completed (9 AM)');
    });
  }, [setTempStatus]);

  // ── Load CSV export path & schedule info on mount ────────────────────────
  useEffect(() => {
    if (!window.electronAPI) return;
    window.electronAPI.csvGetExportPath?.().then(r => {
      if (r?.success) setCsvExportPath(r.exportPath);
    });
    window.electronAPI.getBackupSchedule?.().then(r => {
      if (r?.success) setBackupScheduleInfo(r);
    });
  }, []);

  // ── Load products from DB into inventory table ────────────────────────────
  const loadInventoryFromDB = useCallback(async () => {
    if (!window.electronAPI) return;
    try {
      const r = await window.electronAPI.getProducts();
      if (r?.success) {
        const products = r.products || [];
        // Build rows and headers dynamically from product data + custom fields
        const cfKeys = new Set();
        for (const p of products) {
          if (p.custom_fields && typeof p.custom_fields === 'object') {
            Object.keys(p.custom_fields).forEach(k => cfKeys.add(k));
          }
        }
        const cfKeysArr = Array.from(cfKeys);
        const baseHeaders = [barcodeColName, 'Name', 'SKU', 'Price', quantityColName, 'Category', timestampColName, ...cfKeysArr];
        const mappedRows = products.map(toInventoryRow);
        startTransition(() => {
          setHeaders(baseHeaders);
          setRows(mappedRows);
          setProductsCount(products.length);
          setUniqueItems(products.length);
          setInventoryPage(1);
          setInventoryScrollTop(0);
        });
      }
    } catch { /* ignore */ }
  }, [toInventoryRow]);

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (!cancelled) void loadInventoryFromDB();
    };

    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(run, { timeout: 1000 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback?.(id);
      };
    }

    const timeoutId = window.setTimeout(run, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [loadInventoryFromDB]);

  // Reload when products change externally
  useEffect(() => {
    const handler = () => loadInventoryFromDB();
    window.addEventListener('products:changed', handler);
    return () => window.removeEventListener('products:changed', handler);
  }, [loadInventoryFromDB]);

  // ── Helpers ──────────────────────────────────────────────────────────────
  const showLastScanPopup = useCallback((entry) => {
    if (activeTab !== 'data') return;
    setLastScanPopup(entry);
    clearTimeout(popupTimer.current);
    popupTimer.current = setTimeout(() => setLastScanPopup(null), 3000);
  }, [activeTab]);

  // ── Barcode processing (DB-based) ─────────────────────────────────────────
  const processBarcode = useCallback(async (barcode, source = 'scan') => {
    if (!window.electronAPI) {
      // Browser / dev mode fallback — just update local state
      const existing = rowsRef.current.find(r => String(r[barcodeColName]) === String(barcode));
      const now = new Date().toLocaleString();
      const isDuplicate = Boolean(existing);
      startTransition(() => {
        setRows(prev => {
          if (existing) {
            return prev.map(r => (
              String(r[barcodeColName]) === String(barcode)
                ? {
                    ...r,
                    [quantityColName]: (Number(r[quantityColName]) || 0) + 1,
                    [timestampColName]: now,
                    __searchText: [
                      r[barcodeColName],
                      r.Name,
                      r.SKU,
                      r.Price,
                      (Number(r[quantityColName]) || 0) + 1,
                      r.Category,
                      now,
                    ].map(value => String(value ?? '')).join(' ').toLowerCase(),
                  }
                : r
            ));
          }
          return [...prev, {
            [barcodeColName]: barcode,
            Name: '',
            SKU: '',
            Price: 0,
            [quantityColName]: 1,
            Category: '',
            [timestampColName]: now,
            __searchText: [barcode, 0, 1, now].map(value => String(value ?? '')).join(' ').toLowerCase(),
          }];
        });
        if (!isDuplicate) {
          setUniqueItems(count => count + 1);
          setProductsCount(count => count + 1);
        }
      });
      const entry = { barcode, time: new Date().toLocaleTimeString(), isDuplicate, source };
      setScans(prev => [entry, ...prev.slice(0, 99)]);
      showLastScanPopup(entry);
      setTotalScansToday(p => p + 1);
      setTempStatus(isDuplicate ? 'duplicate' : 'success', isDuplicate ? `+1 qty: ${barcode}` : `New item: ${barcode}`);
      return;
    }

    if (activeTab === 'barcode') return;

    try {
      // Get or create product in DB
      const getResult = await window.electronAPI.getProduct(barcode);
      const existing  = getResult?.product || null;

      const now = new Date().toISOString();
      if (existing) {
        // Increment quantity in DB
        const updated = {
          ...existing,
          quantity: (existing.quantity || 0) + 1,
          updated_at: now,
        };
        await window.electronAPI.saveProduct(updated);
        applyInventoryRow(updated);
        const entry = { barcode, time: new Date().toLocaleTimeString(), isDuplicate: true, source };
        setScans(prev => [entry, ...prev.slice(0, 99)]);
        showLastScanPopup(entry);
        setTotalScansToday(p => p + 1);
        setTempStatus('duplicate', `+1 qty: ${barcode}`);
      } else {
        // New product: create with quantity 1
        const newProduct = {
          barcode,
          name: '',
          sku: '',
          price: 0,
          quantity: 1,
          scan_mode: inventoryAddMode,
          category: '',
          custom_fields: {},
        };
        const saveResult = await window.electronAPI.saveProduct(newProduct);
        if (!saveResult?.success) {
          setTempStatus('error', saveResult?.error || 'Save failed');
          return;
        }
        applyInventoryRow({ ...newProduct, created_at: now, updated_at: now }, { createIfMissing: true });
        const entry = { barcode, time: new Date().toLocaleTimeString(), isDuplicate: false, source };
        setScans(prev => [entry, ...prev.slice(0, 99)]);
        showLastScanPopup(entry);
        setTotalScansToday(p => p + 1);
        setTempStatus('success', `New item: ${barcode}`);
      }

      return;
    } catch (err) {
      setTempStatus('error', err.message || 'Scan failed');
    }
  }, [activeTab, inventoryAddMode, applyInventoryRow, showLastScanPopup, setTempStatus]);

  const handleScannedBarcode = useCallback(async (barcode, source = 'scan') => {
    if (!window.electronAPI) {
      await processBarcode(barcode, source);
      return;
    }
    if (activeTab === 'billing' || (activeTab === 'data' && inventoryAddMode === 'normal')) {
      if (activeTab !== 'billing') setActiveTab('billing');
      window.postMessage({ action: 'billing:scan', barcode }, '*');
      return;
    }
    await processBarcode(barcode, source);
  }, [activeTab, inventoryAddMode, processBarcode]);

  // ── Keyboard listener ─────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (e.key === 'Enter') {
        const barcode = barcodeBuffer.current;
        barcodeBuffer.current = '';
        clearTimeout(bufferTimer.current);
        if (barcode.trim().length > 2) void handleScannedBarcode(barcode, 'scan');
      } else if (e.key.length === 1) {
        barcodeBuffer.current += e.key;
        clearTimeout(bufferTimer.current);
        bufferTimer.current = setTimeout(() => { barcodeBuffer.current = ''; }, 100);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleScannedBarcode]);

  useEffect(() => () => clearTimeout(popupTimer.current), []);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleExport = async () => {
    if (!window.electronAPI) return;
    const r = await window.electronAPI.csvExportAll();
    if (r.success) {
      setCsvExportPath(r.filePath);
      setTempStatus('success', `Exported: ${r.filePath.split(/[\\/]/).pop()}`);
    } else {
      setTempStatus('error', r.error || 'Export cancelled');
    }
  };

  const handleSetExportPath = async () => {
    if (!window.electronAPI) return;
    const r = await window.electronAPI.csvSetExportPath();
    if (r.success) setCsvExportPath(r.exportPath);
  };

  const handleCreateBackup = async () => {
    if (!window.electronAPI) return;
    setBackupProgress({ operation: 'backup:create', status: 'running', phase: 'Starting backup', progress: 0, details: '', updatedAt: Date.now() });
    const result = await window.electronAPI.createBackup();
    if (result.success) {
      setBackupProgress(prev => ({ ...prev, status: 'success', phase: 'Backup completed', progress: 100, details: `Saved to ${result.backupPath?.split(/[\\/]/).pop()}`, updatedAt: Date.now() }));
      setTempStatus('success', 'Backup saved');
      // Refresh schedule info
      window.electronAPI.getBackupSchedule?.().then(r => { if (r?.success) setBackupScheduleInfo(r); });
    } else {
      setBackupProgress(prev => ({ ...prev, status: 'error', phase: 'Backup failed', progress: 100, details: result.error || 'Backup failed', updatedAt: Date.now() }));
      setTempStatus('error', result.error || 'Backup failed');
    }
  };

  const handleRestoreBackup = async () => {
    if (!window.electronAPI) return;
    setBackupProgress({ operation: 'backup:restore', status: 'running', phase: 'Starting restore', progress: 0, details: '', updatedAt: Date.now() });
    const result = await window.electronAPI.restoreBackup();
    if (result.success) {
      setBackupProgress(prev => ({ ...prev, status: 'success', phase: 'Restore completed', progress: 100, details: 'Database restored', updatedAt: Date.now() }));
      setTempStatus('success', 'Restore complete');
      await loadInventoryFromDB();
      window.dispatchEvent(new Event('products:changed'));
      window.dispatchEvent(new Event('data:restored'));
    } else {
      setBackupProgress(prev => ({ ...prev, status: 'error', phase: 'Restore failed', progress: 100, details: result.error || 'Restore failed', updatedAt: Date.now() }));
      setTempStatus('error', result.error || 'Restore failed');
    }
  };

  const handleRunBackupNow = async () => {
    if (!window.electronAPI) return;
    setTempStatus('idle', 'Running backup…');
    const r = await window.electronAPI.runBackupNow?.();
    if (r?.success) {
      setTempStatus('success', 'Backup & CSV updated');
      window.electronAPI.getBackupSchedule?.().then(rs => { if (rs?.success) setBackupScheduleInfo(rs); });
    } else {
      setTempStatus('error', r?.error || 'Backup failed');
    }
  };

  const dismissUpdatePrompt = useCallback(() => {
    const skipVersion = updateInfo?.latestVersion || updateInfo?.tag || '';
    if (skipVersion) localStorage.setItem(UPDATE_SKIP_KEY, skipVersion);
    setShowUpdatePrompt(false);
    setUpdateStatus('Update skipped for now');
  }, [updateInfo]);

  const checkForUpdates = useCallback(async () => {
    const repo = UPDATE_REPO.trim();
    if (!repo) { setUpdateStatus('Update source is not configured'); return; }
    if (!isOnline) { setUpdateStatus('You are offline. Update check skipped.'); return; }
    setUpdateBusy(true);
    setUpdateStatus('Checking GitHub releases…');
    setUpdateInfo(null);
    setShowUpdatePrompt(false);
    try {
      const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
      const release = await response.json();
      const asset = (release.assets || []).find(item => /\.(exe|AppImage)$/i.test(item.name) && !/blockmap/i.test(item.name))
        || (release.assets || []).find(item => !/blockmap/i.test(item.name));
      const currentVersion = String(appVersion || '').replace(/^v/i, '');
      const latestVersion  = String(release.tag_name || '').replace(/^v/i, '');
      const isUpToDate = currentVersion && latestVersion && currentVersion === latestVersion;
      const info = { tag: release.tag_name || '', name: release.name || release.tag_name || 'Latest release', body: release.body || '', assetName: asset?.name || '', assetUrl: asset?.browser_download_url || '', currentVersion, latestVersion, publishedAt: release.published_at || '', updateAvailable: !isUpToDate };
      const skippedVersion = localStorage.getItem(UPDATE_SKIP_KEY) || '';
      const releaseKey = info.latestVersion || info.tag || '';
      setUpdateInfo(info);
      setShowUpdatePrompt(info.updateAvailable !== false && Boolean(info.assetUrl) && skippedVersion !== releaseKey);
      setUpdateStatus(isUpToDate ? 'You are already on the latest version' : `Update available: ${info.latestVersion || info.tag}`);
    } catch (error) {
      setUpdateStatus(error.message || 'Unable to check updates');
    } finally {
      setUpdateBusy(false);
    }
  }, [appVersion, isOnline]);

  useEffect(() => {
    if (!isOnline || !appVersion) return;
    const timer = window.setTimeout(() => { void checkForUpdates(); }, 0);
    return () => window.clearTimeout(timer);
  }, [isOnline, appVersion, checkForUpdates]);

  const downloadAndInstallUpdate = async () => {
    if (updateInfo && updateInfo.updateAvailable === false) { setUpdateStatus(`Already on latest version`); return; }
    if (!window.electronAPI || !updateInfo?.assetUrl) { setUpdateStatus('No downloadable update found'); return; }
    setUpdateBusy(true);
    setUpdateStatus('Downloading update…');
    try {
      const result = await window.electronAPI.downloadAndInstallUpdate({ url: updateInfo.assetUrl, filename: updateInfo.assetName });
      if (result.success) {
        setShowUpdatePrompt(false);
        setUpdateStatus(result.launched ? 'Installer launched. Follow the setup wizard.' : `Downloaded to ${result.downloadedPath}`);
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

  // ── Derived data ─────────────────────────────────────────────────────────
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const inventoryPageSize  = 50;
  const inventoryRowHeight = 42;
  const inventoryOverscan  = 6;

  const filteredRows = useMemo(() => {
    const term = deferredSearchQuery.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(row => String(row.__searchText || '').includes(term));
  }, [deferredSearchQuery, rows]);

  const duplicateCount = useMemo(() => scans.reduce((c, s) => c + (s.isDuplicate ? 1 : 0), 0), [scans]);
  const totalQuantity  = useMemo(() => rows.reduce((sum, r) => sum + (Number(r[quantityColName]) || 0), 0), [rows]);

  const displayHeaders = useMemo(
    () => headers.filter(h => h !== 'Scan Mode' && h !== 'scan_mode'),
    [headers]
  );

  const totalInventoryPages  = Math.max(1, Math.ceil(filteredRows.length / inventoryPageSize));
  const currentInventoryPage = Math.min(inventoryPage, totalInventoryPages);
  const inventoryPageStart   = (currentInventoryPage - 1) * inventoryPageSize;
  const inventoryPageRows    = useMemo(() => filteredRows.slice(inventoryPageStart, inventoryPageStart + inventoryPageSize), [filteredRows, inventoryPageStart]);

  const inventoryVisibleStart = Math.max(0, Math.floor(inventoryScrollTop / inventoryRowHeight) - inventoryOverscan);
  const inventoryVisibleCount = Math.max(1, Math.ceil((inventoryViewportHeight || inventoryRowHeight) / inventoryRowHeight) + inventoryOverscan * 2);
  const inventoryVisibleRows  = useMemo(() => inventoryPageRows.slice(inventoryVisibleStart, inventoryVisibleStart + inventoryVisibleCount), [inventoryPageRows, inventoryVisibleCount, inventoryVisibleStart]);
  const inventoryVisibleEnd   = inventoryVisibleStart + inventoryVisibleRows.length;
  const inventoryTopSpacer    = inventoryVisibleStart * inventoryRowHeight;
  const inventoryBottomSpacer = Math.max(0, (inventoryPageRows.length - inventoryVisibleEnd) * inventoryRowHeight);

  useEffect(() => {
    const update = () => setInventoryViewportHeight(tableWrapRef.current?.clientHeight || 0);
    update();
    if (typeof ResizeObserver !== 'undefined' && tableWrapRef.current) {
      const obs = new ResizeObserver(update);
      obs.observe(tableWrapRef.current);
      return () => obs.disconnect();
    }
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    if (tableWrapRef.current) tableWrapRef.current.scrollTop = 0;
  }, [currentInventoryPage]);

  useEffect(() => {
    if (activeTab !== 'data') return;
    const latestBarcode = scans[0]?.barcode;
    if (!latestBarcode || !tableBodyRef.current || filteredRows.length === 0) return;
    const targetIndex = filteredRows.findIndex(row => String(row[barcodeColName]) === String(latestBarcode));
    if (targetIndex < 0) return;
    const targetVisibleIndex = targetIndex - inventoryPageStart - inventoryVisibleStart;
    if (targetVisibleIndex < 0 || targetVisibleIndex >= inventoryVisibleRows.length) {
      if (tableWrapRef.current) tableWrapRef.current.scrollTop = Math.max(0, (targetIndex - inventoryPageStart) * inventoryRowHeight);
      return;
    }
    const targetRow = tableBodyRef.current.children[targetVisibleIndex + 1];
    if (targetRow && typeof targetRow.scrollIntoView === 'function') targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeTab, barcodeColName, filteredRows, inventoryPageStart, inventoryRowHeight, inventoryVisibleRows, inventoryVisibleStart, scans]);

  // ── Status helpers ───────────────────────────────────────────────────────
  const statusColors = { success: 'var(--green)', duplicate: 'var(--amber)', error: 'var(--red)', idle: 'var(--muted)' };
  const statusLabels = { success: 'Updated', duplicate: 'Qty +1', error: 'Error', idle: 'Ready' };
  const backupStatusMeta = backupProgress?.status === 'error'
    ? { label: 'Failed', color: 'var(--red)' }
    : backupProgress?.status === 'success'
      ? { label: 'Completed', color: 'var(--green)' }
      : { label: 'Running', color: 'var(--accent2)' };
  const backupProgressValue = typeof backupProgress?.progress === 'number'
    ? Math.max(0, Math.min(100, backupProgress.progress))
    : backupProgress?.status === 'running' ? 55 : backupProgress?.status === 'success' ? 100 : 0;
  const backupIsBusy = backupProgress?.status === 'running';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {showUpdatePrompt && updateInfo && (
        <div className="update-overlay" role="dialog" aria-modal="true" aria-labelledby="update-overlay-title">
          <div className="update-overlay-card">
            <div className="update-overlay-badge">Update available</div>
            <h2 id="update-overlay-title" className="update-overlay-title">{updateInfo.name || 'Latest release'}</h2>
            <p className="update-overlay-copy">A newer version is ready while you are online.</p>
            <div className="update-overlay-grid">
              <div className="update-overlay-metric"><span>Current</span><strong>{updateInfo.currentVersion || appVersion || 'Unknown'}</strong></div>
              <div className="update-overlay-metric"><span>Latest</span><strong>{updateInfo.latestVersion || updateInfo.tag || 'Unknown'}</strong></div>
              <div className="update-overlay-metric"><span>Status</span><strong>{isOnline ? 'Online' : 'Offline'}</strong></div>
              <div className="update-overlay-metric"><span>Published</span><strong>{updateInfo.publishedAt ? new Date(updateInfo.publishedAt).toLocaleDateString() : 'Unknown'}</strong></div>
            </div>
            {updateInfo.body && <div className="update-overlay-notes">{updateInfo.body}</div>}
            <div className="update-overlay-actions">
              <button className="btn-accent btn-lg" onClick={downloadAndInstallUpdate} disabled={updateBusy || !updateInfo?.assetUrl}><IconDownload /> Install Update</button>
              <button className="btn-ghost btn-lg" onClick={dismissUpdatePrompt} disabled={updateBusy}>Skip for now</button>
              <button className="btn-ghost btn-lg" onClick={checkForUpdates} disabled={updateBusy}><IconRefresh /> Check again</button>
            </div>
            <div className="update-overlay-footer">{updateStatus}</div>
          </div>
        </div>
      )}

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
            <button className="btn-accent" onClick={handleExport} title="Export full database to CSV (read-only)">
              <IconDownload /> Export CSV
            </button>
          </div>
        </header>

        <div className="app-body">
          {/* Sidebar */}
          <aside className="sidebar">
            <div className="sidebar-inner">

              {activeTab === 'data' && (
                <section className="sidebar-section inventory-mode-section">
                  <span className="section-label">Inventory Mode</span>
                  <div className="inventory-mode-card">
                    <div className="mode-toggle-row">
                      <button className={`mode-chip ${inventoryAddMode === 'inventory_only' ? 'active' : ''}`} onClick={() => setInventoryAddMode('inventory_only')} type="button">
                        <span className="mode-chip-title">Inventory only</span>
                        <span className="mode-chip-sub">Scan updates stock</span>
                      </button>
                      <button className={`mode-chip ${inventoryAddMode === 'normal' ? 'active' : ''}`} onClick={() => setInventoryAddMode('normal')} type="button">
                        <span className="mode-chip-title">Normal</span>
                        <span className="mode-chip-sub">Scan adds to billing</span>
                      </button>
                    </div>
                    <div className="field-hint">Selected mode controls how the next scan behaves.</div>
                  </div>
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
                    <div className="stat-value">{formatNumber(duplicateCount, { maximumFractionDigits: 0 })}</div>
                    <div className="stat-label">Updates</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value">{formatNumber(totalQuantity, { maximumFractionDigits: 0 })}</div>
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
                <button className={`tab ${activeTab === 'data' ? 'tab-on' : ''}`} onClick={() => setActiveTab('data')}><IconTable /> Inventory</button>
                <button className={`tab ${activeTab === 'barcode' ? 'tab-on' : ''}`} onClick={() => setActiveTab('barcode')}><IconBarcode /> Barcode Creator</button>
                <button className={`tab ${activeTab === 'billing' ? 'tab-on' : ''}`} onClick={() => setActiveTab('billing')}><IconPrinter /> Billing</button>
                <button className={`tab ${activeTab === 'settings' ? 'tab-on' : ''}`} onClick={() => setActiveTab('settings')}><IconSettings /> Settings</button>
              </div>
              {activeTab === 'data' && rows.length > 0 && (
                <div className="tab-right">
                  <div className="search-box">
                    <IconSearch />
                    <input className="search-input" placeholder="Filter rows…" value={searchQuery}
                      onChange={e => { setSearchQuery(e.target.value); setInventoryPage(1); setInventoryScrollTop(0); }} />
                    {searchQuery && <button className="search-clear" onClick={() => { setSearchQuery(''); setInventoryPage(1); setInventoryScrollTop(0); }}>×</button>}
                  </div>
                  <span className="row-count">{filteredRows.length} of {rows.length}</span>
                </div>
              )}
            </div>

            {activeTab === 'billing' ? (
              <Suspense fallback={<div className="panel-loading">Loading billing…</div>}>
                <BillingModule />
              </Suspense>
            ) : activeTab === 'barcode' ? (
              <Suspense fallback={<div className="panel-loading">Loading barcode tools…</div>}>
                <BarcodeGenerator />
              </Suspense>
            ) : activeTab === 'data' ? (
              <div className="table-wrap" ref={tableWrapRef} onScroll={(e) => setInventoryScrollTop(e.currentTarget.scrollTop)}>
                {rows.length > 0 && filteredRows.length > 0 && (
                  <div className="pagination-bar">
                    <div className="pagination-meta">Showing {inventoryPageStart + 1}–{Math.min(inventoryPageStart + inventoryPageSize, filteredRows.length)} of {filteredRows.length}</div>
                    <div className="pagination-controls">
                      <button className="btn-ghost btn-sm" onClick={() => { setInventoryPage(1); setInventoryScrollTop(0); }} disabled={currentInventoryPage === 1}>First</button>
                      <button className="btn-ghost btn-sm" onClick={() => { setInventoryPage(p => Math.max(1, p - 1)); setInventoryScrollTop(0); }} disabled={currentInventoryPage === 1}>Prev</button>
                      <span className="pagination-page">Page {currentInventoryPage} / {totalInventoryPages}</span>
                      <button className="btn-ghost btn-sm" onClick={() => { setInventoryPage(p => Math.min(totalInventoryPages, p + 1)); setInventoryScrollTop(0); }} disabled={currentInventoryPage >= totalInventoryPages}>Next</button>
                      <button className="btn-ghost btn-sm" onClick={() => { setInventoryPage(totalInventoryPages); setInventoryScrollTop(0); }} disabled={currentInventoryPage >= totalInventoryPages}>Last</button>
                    </div>
                  </div>
                )}

                {searchQuery && filteredRows.length === 0 ? (
                  <div className="empty-state"><h2 className="empty-h">No results</h2><p className="empty-p">No records match "{searchQuery}"</p></div>
                ) : rows.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-art">
                      {[3,7,11,13,17,19,22,26,29,31,35,38,41].map((x, i) => (
                        <div key={i} className="empty-bar" style={{ left: x, height: 40 + (i % 4) * 12, opacity: 0.12 + (i % 3) * 0.1 }}></div>
                      ))}
                    </div>
                    <h2 className="empty-h">No inventory yet</h2>
                    <p className="empty-p">Aim the scanner and fire — data saves directly to the database.</p>
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
                      {inventoryTopSpacer > 0 && (
                        <tr aria-hidden="true" className="virtual-spacer-row">
                          <td colSpan={displayHeaders.length + 1} style={{ height: `${inventoryTopSpacer}px`, padding: 0, border: 'none' }} />
                        </tr>
                      )}
                      {inventoryVisibleRows.map((row, i) => {
                        const isLatest = scans[0]?.barcode === String(row[barcodeColName]);
                        return (
                          <tr key={i} className={isLatest ? 'row-fresh' : ''}>
                            <td className="td-num">{inventoryPageStart + inventoryVisibleStart + i + 1}</td>
                            {displayHeaders.map(h => (
                              <td key={h} className={h === barcodeColName ? 'td-code' : h === quantityColName ? 'td-qty' : ''}>
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
                      {inventoryBottomSpacer > 0 && (
                        <tr aria-hidden="true" className="virtual-spacer-row">
                          <td colSpan={displayHeaders.length + 1} style={{ height: `${inventoryBottomSpacer}px`, padding: 0, border: 'none' }} />
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            ) : (
              /* Settings Panel */
              <div className="settings-panel">

                <div className="settings-block">
                  <h3 className="settings-h">CSV Export</h3>
                  <p className="settings-p">
                    Export all database data — products, invoices, invoice items, and custom fields — into a single read-only CSV file.
                    Once a location is set, every export overwrites the same file.
                  </p>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '10px' }}>
                    <button className="btn-accent" onClick={handleExport}>
                      <IconDownload /> Export Now
                    </button>
                    <button className="btn-ghost" onClick={handleSetExportPath}>
                      <IconFile /> Change Location
                    </button>
                  </div>
                  {csvExportPath ? (
                    <div className="field-hint" style={{ wordBreak: 'break-all' }}>
                      📄 Export path: <strong>{csvExportPath}</strong>
                      <br />The file is marked read-only after each export to prevent accidental edits.
                    </div>
                  ) : (
                    <div className="field-hint">No export location set. Click "Export Now" to choose one.</div>
                  )}
                </div>

                <div className="settings-block">
                  <h3 className="settings-h">How It Works</h3>
                  <div className="info-grid">
                    <InfoCard icon="⌨" title="HID Keyboard Mode" body="USB or Bluetooth scanners type the barcode then press Enter. No drivers needed." />
                    <InfoCard icon="⚡" title="100ms Buffer" body="Characters arriving within 100ms are treated as a scan. Slower keyboard input is ignored." />
                    <InfoCard icon="🗄️" title="SQLite Database" body="All data is stored locally in a SQLite database. No Excel files. No data loss." />
                    <InfoCard icon="📄" title="Read-Only CSV" body="Exported CSVs are marked read-only to protect data integrity. Re-export to refresh." />
                  </div>
                </div>

                <div className="settings-block">
                  <h3 className="settings-h">Backup & Restore</h3>
                  <p className="settings-p">
                    Backups capture all products, invoices, custom fields, and shop settings into a JSON file.
                    A read-only CSV companion is also written alongside.
                  </p>

                  <div className="backup-schedule-card" style={{ marginBottom: '14px', padding: '10px 14px', background: 'var(--surface2)', borderRadius: '8px', fontSize: '13px' }}>
                    <div style={{ fontWeight: 600, marginBottom: '4px' }}>⏰ Auto-Backup Schedule</div>
                    <div style={{ color: 'var(--muted)' }}>
                      Runs automatically every day at <strong>9:00 AM</strong>.
                    </div>
                    {backupScheduleInfo && (
                      <div style={{ color: 'var(--muted)', marginTop: '4px' }}>
                        Next run: <strong>{new Date(backupScheduleInfo.nextRunAt).toLocaleString()}</strong>
                        <br />Backup folder: <span style={{ wordBreak: 'break-all' }}>{backupScheduleInfo.backupDir}</span>
                      </div>
                    )}
                    {lastAutoBackup && (
                      <div style={{ color: 'var(--green)', marginTop: '4px' }}>
                        Last auto-backup: {new Date(lastAutoBackup.timestamp).toLocaleString()}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button className="btn-accent" onClick={handleCreateBackup} disabled={backupIsBusy}>
                      {backupIsBusy && backupProgress?.operation === 'backup:create' ? 'Backing Up…' : 'Backup Now'}
                    </button>
                    <button className="btn-ghost" onClick={handleRestoreBackup} disabled={backupIsBusy}>
                      {backupIsBusy && backupProgress?.operation === 'backup:restore' ? 'Restoring…' : 'Restore From Backup'}
                    </button>
                    <button className="btn-ghost" onClick={handleRunBackupNow} disabled={backupIsBusy} title="Run full backup + CSV update right now">
                      ▶ Run Auto-Backup Now
                    </button>
                  </div>

                  <div className={`backup-progress-card ${backupProgress?.status || 'idle'}`} aria-live="polite" aria-busy={backupIsBusy}>
                    <div className="backup-progress-header">
                      <div>
                        <div className="backup-progress-title">
                          {backupProgress?.operation === 'backup:restore' ? 'Restore progress' : 'Backup progress'}
                        </div>
                        <div className="backup-progress-subtitle">{backupProgress?.phase || 'Waiting for backup or restore to start'}</div>
                      </div>
                      <div className="backup-progress-badge" style={{ '--bp-color': backupStatusMeta.color }}>{backupStatusMeta.label}</div>
                    </div>
                    <div className="backup-progress-bar">
                      <div className="backup-progress-fill" style={{ width: `${backupProgressValue}%`, '--bp-color': backupStatusMeta.color }} />
                    </div>
                    <div className="backup-progress-footer">
                      <span>{backupProgressValue}%</span>
                      <span>{backupProgress?.details || (backupProgress?.status === 'success' ? 'Operation completed successfully' : backupProgress?.status === 'error' ? 'Operation failed' : 'Idle')}</span>
                    </div>
                  </div>

                  <div className="field-hint" style={{ marginTop: '10px' }}>
                    The auto-backup also updates the configured CSV export path (if set) every morning at 9 AM.
                  </div>
                </div>

                <div className="settings-block">
                  <h3 className="settings-h">Update Center</h3>
                  <div className="update-current-version">Current Version: {appVersion || 'Unknown'}</div>
                  <div className="update-actions">
                    <button className="btn-ghost" onClick={checkForUpdates} disabled={updateBusy}><IconRefresh /> Check for Update</button>
                    <button className="btn-accent" onClick={downloadAndInstallUpdate} disabled={updateBusy || !updateInfo?.assetUrl || updateInfo?.updateAvailable === false}><IconDownload /> Download & Install</button>
                  </div>
                  {updateInfo && (
                    <div className="update-card">
                      <div className="update-card-title">{updateInfo.name || 'Latest release'}</div>
                      <div className="update-card-subtitle">{updateInfo.publishedAt ? `Published ${new Date(updateInfo.publishedAt).toLocaleString()}` : 'Release details'}</div>
                      <div className="update-card-line"><span>Current</span><span>{updateInfo.currentVersion || appVersion || 'Unknown'}</span></div>
                      <div className="update-card-line"><span>Latest</span><span>{updateInfo.latestVersion || updateInfo.tag || 'Unknown'}</span></div>
                      <div className="update-card-line"><span>Status</span><span>{updateInfo.updateAvailable === false ? 'Up to date' : 'Update ready'}</span></div>
                    </div>
                  )}
                  <div className="update-status">{updateStatus}</div>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </>
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
const IconDownload = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
const IconRefresh = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15A9 9 0 106 6.51L1 11m23 9l-5-5"/></svg>;
const IconFile = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
const IconEnter = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 01-4 4H4"/></svg>;
const IconTable = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>;
const IconSettings = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>;
const IconSearch = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
const IconBarcode = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="2" height="16" rx="0.5"/><rect x="5" y="4" width="1" height="16" rx="0.5"/><rect x="7" y="4" width="2" height="16" rx="0.5"/><rect x="11" y="4" width="1" height="16" rx="0.5"/><rect x="13" y="4" width="3" height="16" rx="0.5"/><rect x="17" y="4" width="1" height="16" rx="0.5"/><rect x="19" y="4" width="3" height="16" rx="0.5"/></svg>;
const IconPrinter = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>;
