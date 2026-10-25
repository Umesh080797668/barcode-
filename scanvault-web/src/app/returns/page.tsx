'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import AppShell from '../components/AppShell';
import { getSupplierReturns, saveSupplierReturn, receiveSupplierReplacement, getProduct } from '@/lib/api';

const fmt = (n: number) => (n || 0).toLocaleString('en', { minimumFractionDigits: 2 });

interface ProductInfo {
  barcode: string;
  name: string;
  price?: number;
  quantity?: number;
  category?: string;
  modal?: string;
}

export default function SupplierReturnsPage() {
  // Form state
  const [returnedBarcode, setReturnedBarcode] = useState('');
  const [returnedProduct, setReturnedProduct] = useState<ProductInfo | null>(null);
  const [returnedQty, setReturnedQty] = useState(1);
  const [returnType, setReturnType] = useState<'no_replacement' | 'replaced' | 'pending_replacement'>('no_replacement');
  const [replacementBarcode, setReplacementBarcode] = useState('');
  const [replacementProduct, setReplacementProduct] = useState<ProductInfo | null>(null);
  const [replacementQty, setReplacementQty] = useState(1);
  const [notes, setNotes] = useState('');

  // UI state
  const [searchingRet, setSearchingRet] = useState(false);
  const [searchingRep, setSearchingRep] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [history, setHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [stockMap, setStockMap] = useState<Record<string, number>>({});

  // Receive-replacement modal state
  const [receiveModal, setReceiveModal] = useState<any | null>(null);
  const [rcvBarcode, setRcvBarcode] = useState('');
  const [rcvProduct, setRcvProduct] = useState<ProductInfo | null>(null);
  const [rcvQty, setRcvQty] = useState(1);
  const [rcvSearching, setRcvSearching] = useState(false);
  const [rcvSubmitting, setRcvSubmitting] = useState(false);

  const showStatus = (msg: string, isErr = false) => {
    if (isErr) {
      setError(msg);
      setSuccessMsg('');
    } else {
      setSuccessMsg(msg);
      setError('');
    }
    setTimeout(() => {
      setError('');
      setSuccessMsg('');
    }, 4000);
  };

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await getSupplierReturns(100);
      const list = Array.isArray(res) ? res : (res?.returns || []);
      setHistory(list);

      // Hydrate current stock for returned barcodes
      const uniqueBcs = [...new Set(list.map((r: any) => r.returned_barcode).filter(Boolean))] as string[];
      const entries = await Promise.all(
        uniqueBcs.map(async (bc) => {
          try {
            const p = await getProduct(bc);
            return [bc, p ? Number(p.quantity ?? 0) : 0] as [string, number];
          } catch {
            return [bc, 0] as [string, number];
          }
        })
      );
      setStockMap(Object.fromEntries(entries));
    } catch (err: any) {
      setError(err.message || 'Failed to load returns history');
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Lookup helper
  const lookupProduct = async (
    bc: string,
    setProd: (p: ProductInfo | null) => void,
    setBusy: (b: boolean) => void
  ) => {
    const trimmed = bc.trim();
    if (!trimmed) {
      setProd(null);
      return;
    }
    setBusy(true);
    try {
      const res = await getProduct(trimmed);
      setProd(res?.product || res || null);
    } catch {
      setProd(null);
    } finally {
      setBusy(false);
    }
  };

  // Debounced lookup for returned product
  useEffect(() => {
    const timer = setTimeout(() => {
      lookupProduct(returnedBarcode, setReturnedProduct, setSearchingRet);
    }, 350);
    return () => clearTimeout(timer);
  }, [returnedBarcode]);

  // Debounced lookup for replacement product
  useEffect(() => {
    if (returnType !== 'replaced') {
      setReplacementProduct(null);
      return;
    }
    const timer = setTimeout(() => {
      lookupProduct(replacementBarcode, setReplacementProduct, setSearchingRep);
    }, 350);
    return () => clearTimeout(timer);
  }, [replacementBarcode, returnType]);

  // Debounced lookup for receive replacement
  useEffect(() => {
    if (!receiveModal) {
      setRcvProduct(null);
      return;
    }
    const timer = setTimeout(() => {
      lookupProduct(rcvBarcode, setRcvProduct, setRcvSearching);
    }, 350);
    return () => clearTimeout(timer);
  }, [rcvBarcode, receiveModal]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returnedBarcode.trim()) {
      showStatus('Please enter the returned product barcode.', true);
      return;
    }
    if (returnType === 'replaced' && !replacementBarcode.trim()) {
      showStatus('Please enter the replacement product barcode.', true);
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        returned_barcode: returnedBarcode.trim(),
        returned_name: returnedProduct?.name || returnedBarcode.trim(),
        returned_qty: Number(returnedQty) || 1,
        return_type: returnType,
        replacement_barcode: returnType === 'replaced' ? replacementBarcode.trim() : null,
        replacement_name: returnType === 'replaced' ? (replacementProduct?.name || replacementBarcode.trim()) : null,
        replacement_modal: returnType === 'replaced' ? (replacementProduct?.modal || null) : null,
        replacement_qty: returnType === 'replaced' ? (Number(replacementQty) || 1) : 0,
        notes: notes.trim() || null,
      };

      await saveSupplierReturn(payload);
      showStatus('Return recorded successfully! Inventory has been updated.');

      // Reset
      setReturnedBarcode('');
      setReturnedProduct(null);
      setReturnedQty(1);
      setReturnType('no_replacement');
      setReplacementBarcode('');
      setReplacementProduct(null);
      setReplacementQty(1);
      setNotes('');

      await loadHistory();
    } catch (err: any) {
      showStatus(err.message || 'Failed to record return', true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReceiveReplacement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receiveModal) return;
    if (!rcvBarcode.trim()) {
      showStatus('Please enter the replacement barcode.', true);
      return;
    }

    setRcvSubmitting(true);
    try {
      const payload = {
        replacement_barcode: rcvBarcode.trim(),
        replacement_name: rcvProduct?.name || rcvBarcode.trim(),
        replacement_modal: rcvProduct?.modal || null,
        replacement_qty: Number(rcvQty) || 1,
      };
      await receiveSupplierReplacement(receiveModal._id || receiveModal.id, payload);
      showStatus('Replacement received and inventory updated!');
      setReceiveModal(null);
      setRcvBarcode('');
      setRcvProduct(null);
      setRcvQty(1);
      await loadHistory();
    } catch (err: any) {
      showStatus(err.message || 'Failed to receive replacement', true);
    } finally {
      setRcvSubmitting(false);
    }
  };

  const renderProductCard = (p: ProductInfo | null, isBusy: boolean, label: string) => {
    if (isBusy) {
      return (
        <div className="p-3 bg-gray-900/60 border border-gray-800 rounded-lg text-xs text-gray-400 animate-pulse">
          Searching {label.toLowerCase()}…
        </div>
      );
    }
    if (!p) return null;
    const isOos = Number(p.quantity) <= 0;
    return (
      <div className={`p-3 rounded-lg border ${isOos ? 'bg-red-950/20 border-red-900/50' : 'bg-gray-900/80 border-gray-700/60'}`}>
        <div className="flex justify-between items-start">
          <div>
            <span className="text-xs font-semibold text-indigo-400 block">{label}</span>
            <span className="text-sm font-medium text-white">{p.name || p.barcode}</span>
            {p.modal && <span className="text-xs text-gray-400 block">Model: {p.modal}</span>}
          </div>
          <div className="text-right">
            <span className={`sv-badge ${isOos ? 'sv-badge-red' : 'sv-badge-green'}`}>
              Stock: {p.quantity ?? 0}
            </span>
            {isOos && <span className="block text-[10px] text-red-400 font-bold mt-1">OUT OF STOCK</span>}
          </div>
        </div>
        <div className="mt-2 pt-2 border-t border-gray-800/60 flex items-center justify-between text-xs text-gray-400">
          <span>Barcode: <code className="text-gray-300">{p.barcode}</code></span>
          {p.price !== undefined && <span>Rs. {fmt(p.price)}</span>}
        </div>
      </div>
    );
  };

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Supplier Returns</h1>
            <p className="text-sm text-gray-400">Record defective stock returned to suppliers and track replacements</p>
          </div>
          <button
            onClick={() => loadHistory()}
            disabled={loadingHistory}
            className="sv-btn sv-btn-ghost text-xs"
          >
            {loadingHistory ? 'Refreshing…' : '↻ Refresh History'}
          </button>
        </div>

        {/* Status Alerts */}
        {error && (
          <div className="p-3 bg-red-950/60 border border-red-800 text-red-300 rounded-lg text-sm animate-fadeIn">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="p-3 bg-green-950/60 border border-green-800 text-green-300 rounded-lg text-sm animate-fadeIn">
            {successMsg}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ── Left Column: Return Entry Form ──────────────────────── */}
          <div className="lg:col-span-1">
            <div className="sv-card space-y-4">
              <h2 className="text-base font-semibold text-white border-b border-gray-800 pb-2">
                New Supplier Return
              </h2>

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Returned Barcode */}
                <div>
                  <label className="sv-label">Returned Product Barcode *</label>
                  <input
                    type="text"
                    required
                    placeholder="Scan or type barcode…"
                    value={returnedBarcode}
                    onChange={(e) => setReturnedBarcode(e.target.value)}
                    className="sv-input font-mono"
                    autoFocus
                  />
                </div>

                {renderProductCard(returnedProduct, searchingRet, 'Returned Product')}

                {/* Return Quantity */}
                <div>
                  <label className="sv-label">Return Quantity *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={returnedQty}
                    onChange={(e) => setReturnedQty(Math.max(1, parseInt(e.target.value) || 1))}
                    className="sv-input"
                  />
                </div>

                {/* Return Type Selection */}
                <div>
                  <label className="sv-label">Resolution Type</label>
                  <div className="grid grid-cols-1 gap-2 mt-1">
                    <label className={`flex items-center p-2.5 rounded-lg border cursor-pointer text-xs transition-colors ${returnType === 'no_replacement' ? 'bg-indigo-950/40 border-indigo-600 text-white' : 'bg-gray-900 border-gray-800 text-gray-400 hover:border-gray-700'}`}>
                      <input
                        type="radio"
                        name="returnType"
                        value="no_replacement"
                        checked={returnType === 'no_replacement'}
                        onChange={() => setReturnType('no_replacement')}
                        className="mr-2 text-indigo-600"
                      />
                      <div>
                        <span className="font-semibold block">Credit / Write-off (No Replacement)</span>
                        <span className="text-[11px] text-gray-400">Stock is deducted immediately</span>
                      </div>
                    </label>

                    <label className={`flex items-center p-2.5 rounded-lg border cursor-pointer text-xs transition-colors ${returnType === 'replaced' ? 'bg-indigo-950/40 border-indigo-600 text-white' : 'bg-gray-900 border-gray-800 text-gray-400 hover:border-gray-700'}`}>
                      <input
                        type="radio"
                        name="returnType"
                        value="replaced"
                        checked={returnType === 'replaced'}
                        onChange={() => setReturnType('replaced')}
                        className="mr-2 text-indigo-600"
                      />
                      <div>
                        <span className="font-semibold block">Immediate Replacement</span>
                        <span className="text-[11px] text-gray-400">Swapped with new product today</span>
                      </div>
                    </label>

                    <label className={`flex items-center p-2.5 rounded-lg border cursor-pointer text-xs transition-colors ${returnType === 'pending_replacement' ? 'bg-indigo-950/40 border-indigo-600 text-white' : 'bg-gray-900 border-gray-800 text-gray-400 hover:border-gray-700'}`}>
                      <input
                        type="radio"
                        name="returnType"
                        value="pending_replacement"
                        checked={returnType === 'pending_replacement'}
                        onChange={() => setReturnType('pending_replacement')}
                        className="mr-2 text-indigo-600"
                      />
                      <div>
                        <span className="font-semibold block">Pending Replacement</span>
                        <span className="text-[11px] text-gray-400">Deducts stock; mark received when supplier delivers</span>
                      </div>
                    </label>
                  </div>
                </div>

                {/* If immediate replacement, enter replacement barcode */}
                {returnType === 'replaced' && (
                  <div className="space-y-3 pt-2 border-t border-gray-800 animate-fadeIn">
                    <div>
                      <label className="sv-label">Replacement Barcode *</label>
                      <input
                        type="text"
                        required
                        placeholder="Scan or type replacement barcode…"
                        value={replacementBarcode}
                        onChange={(e) => setReplacementBarcode(e.target.value)}
                        className="sv-input font-mono"
                      />
                    </div>

                    {renderProductCard(replacementProduct, searchingRep, 'Replacement Product')}

                    <div>
                      <label className="sv-label">Replacement Quantity *</label>
                      <input
                        type="number"
                        min="1"
                        required
                        value={replacementQty}
                        onChange={(e) => setReplacementQty(Math.max(1, parseInt(e.target.value) || 1))}
                        className="sv-input"
                      />
                    </div>
                  </div>
                )}

                {/* Notes */}
                <div>
                  <label className="sv-label">Notes / Reason (optional)</label>
                  <textarea
                    rows={2}
                    placeholder="e.g., Defective charging port, faulty screen…"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="sv-input text-xs"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="sv-btn sv-btn-primary w-full py-2.5 font-medium"
                >
                  {submitting ? 'Recording…' : 'Record Supplier Return'}
                </button>
              </form>
            </div>
          </div>

          {/* ── Right Column: Returns History ───────────────────────── */}
          <div className="lg:col-span-2">
            <div className="sv-card">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-base font-semibold text-white">Returns History</h2>
                <span className="text-xs text-gray-400">{history.length} records</span>
              </div>

              {loadingHistory ? (
                <div className="text-center py-12 text-gray-500 text-sm">Loading history…</div>
              ) : history.length === 0 ? (
                <div className="text-center py-12 text-gray-500 text-sm">No supplier returns recorded yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="sv-table text-xs">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Returned Item</th>
                        <th>Qty</th>
                        <th>Type</th>
                        <th>Replacement</th>
                        <th>Stock</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((item: any) => {
                        const id = item._id || item.id;
                        const dateStr = item.created_at ? new Date(item.created_at).toLocaleDateString() : '—';
                        const curStock = stockMap[item.returned_barcode];

                        return (
                          <tr key={id} className="hover:bg-gray-800/40 transition-colors">
                            <td className="text-gray-400 whitespace-nowrap">{dateStr}</td>
                            <td>
                              <div className="font-medium text-white">{item.returned_name || item.returned_barcode}</div>
                              <div className="text-[11px] font-mono text-gray-500">{item.returned_barcode}</div>
                              {item.notes && <div className="text-[10px] text-gray-400 italic mt-0.5">{item.notes}</div>}
                            </td>
                            <td className="font-semibold text-white">{item.returned_qty}</td>
                            <td>
                              {item.return_type === 'no_replacement' && (
                                <span className="sv-badge sv-badge-blue">No Replace</span>
                              )}
                              {item.return_type === 'replaced' && (
                                <span className="sv-badge sv-badge-green">Replaced</span>
                              )}
                              {item.return_type === 'pending_replacement' && (
                                <span className="sv-badge sv-badge-yellow">Pending</span>
                              )}
                            </td>
                            <td>
                              {item.replacement_barcode ? (
                                <div>
                                  <div className="font-medium text-gray-200">{item.replacement_name || item.replacement_barcode}</div>
                                  <div className="text-[10px] text-gray-500 font-mono">
                                    Qty: {item.replacement_qty} · {item.replacement_barcode}
                                  </div>
                                </div>
                              ) : (
                                <span className="text-gray-500">—</span>
                              )}
                            </td>
                            <td>
                              <span className={`text-[11px] font-mono ${curStock !== undefined && curStock <= 0 ? 'text-red-400 font-bold' : 'text-gray-400'}`}>
                                {curStock !== undefined ? curStock : '—'}
                              </span>
                            </td>
                            <td>
                              {item.return_type === 'pending_replacement' && (
                                <button
                                  onClick={() => {
                                    setReceiveModal(item);
                                    setRcvBarcode(item.replacement_barcode || item.returned_barcode || '');
                                    setRcvQty(item.returned_qty || 1);
                                  }}
                                  className="sv-btn sv-btn-primary py-1 px-2.5 text-[11px]"
                                >
                                  Receive
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Receive Replacement Modal ─────────────────────────────── */}
        {receiveModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
            <div className="sv-card max-w-md w-full shadow-2xl space-y-4">
              <div className="flex justify-between items-center border-b border-gray-800 pb-3">
                <h3 className="text-base font-semibold text-white">Receive Replacement</h3>
                <button
                  onClick={() => setReceiveModal(null)}
                  className="text-gray-400 hover:text-white text-lg font-bold"
                >
                  ✕
                </button>
              </div>

              <div className="text-xs text-gray-400 space-y-1">
                <div>For returned item: <span className="text-white font-medium">{receiveModal.returned_name}</span></div>
                <div>Returned barcode: <code className="text-indigo-400">{receiveModal.returned_barcode}</code></div>
                <div>Returned Qty: <span className="text-white font-medium">{receiveModal.returned_qty}</span></div>
              </div>

              <form onSubmit={handleReceiveReplacement} className="space-y-4">
                <div>
                  <label className="sv-label">Replacement Barcode *</label>
                  <input
                    type="text"
                    required
                    placeholder="Scan or type replacement barcode…"
                    value={rcvBarcode}
                    onChange={(e) => setRcvBarcode(e.target.value)}
                    className="sv-input font-mono"
                    autoFocus
                  />
                </div>

                {renderProductCard(rcvProduct, rcvSearching, 'Replacement Product')}

                <div>
                  <label className="sv-label">Received Quantity *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={rcvQty}
                    onChange={(e) => setRcvQty(Math.max(1, parseInt(e.target.value) || 1))}
                    className="sv-input"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setReceiveModal(null)}
                    className="sv-btn sv-btn-ghost text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={rcvSubmitting}
                    className="sv-btn sv-btn-primary text-xs"
                  >
                    {rcvSubmitting ? 'Saving…' : 'Confirm & Add Stock'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
