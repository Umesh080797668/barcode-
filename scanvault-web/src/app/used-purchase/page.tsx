'use client';

import { useState, useEffect, useCallback } from 'react';
import AppShell from '../components/AppShell';
import { saveInvoice, getInvoices, getInvoice } from '@/lib/api';
import { printReceipt, buildReceiptHTML, openReceiptPreview } from '@/lib/print';

const fmt = (n: number) => (n || 0).toLocaleString('en', { minimumFractionDigits: 2 });

const WARRANTY_OPTIONS = [
  'No warranty',
  '7 days',
  '1 month',
  '3 months',
  '6 months',
  '1 year',
  '2 years',
  '3 years',
  '5 years',
];

interface PurchaseItem {
  id: string;
  name: string;
  model: string;
  price: number | '';
  qty: number;
  warranty: string;
}

const emptyItem = (): PurchaseItem => ({
  id: String(Date.now() + Math.random()),
  name: '',
  model: '',
  price: '',
  qty: 1,
  warranty: 'No warranty',
});

export default function UsedPurchasePage() {
  const [tab, setTab] = useState<'new' | 'history'>('new');

  // Seller Details
  const [sellerName, setSellerName] = useState('');
  const [sellerPhone, setSellerPhone] = useState('');
  const [purchasedShop, setPurchasedShop] = useState('');
  const [notes, setNotes] = useState('');

  // Line items
  const [items, setItems] = useState<PurchaseItem[]>([emptyItem()]);

  // Payment
  const [paidCash, setPaidCash] = useState<number | ''>('');

  // UI state
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState('');

  // History state
  const [history, setHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [printingId, setPrintingId] = useState<string | null>(null);

  const showStatus = (msg: string, isErr = false) => {
    if (isErr) {
      setError(msg);
      setStatusMsg('');
    } else {
      setStatusMsg(msg);
      setError('');
    }
    setTimeout(() => {
      setError('');
      setStatusMsg('');
    }, 4000);
  };

  const updateItem = (id: string, field: keyof PurchaseItem, value: any) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  const addItem = () => setItems((prev) => [...prev, emptyItem()]);

  const removeItem = (id: string) => {
    setItems((prev) => (prev.length > 1 ? prev.filter((i) => i.id !== id) : prev));
  };

  const subtotal = items.reduce(
    (sum, it) => sum + (Number(it.price) || 0) * (Number(it.qty) || 1),
    0
  );
  const cashNum = paidCash === '' ? subtotal : Number(paidCash);
  const balance = subtotal - cashNum;

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const data = await getInvoices(200);
      const list = Array.isArray(data) ? data : (data?.invoices || []);
      setHistory(list.filter((inv: any) => inv.transaction_type === 'used_purchase'));
    } catch (err: any) {
      setError(err.message || 'Failed to load purchase history');
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'history') loadHistory();
  }, [tab, loadHistory]);

  const handleSubmit = async (printAfter: boolean) => {
    if (!sellerName.trim()) {
      showStatus('Seller name is required', true);
      return;
    }
    if (!sellerPhone.trim()) {
      showStatus('Seller phone is required', true);
      return;
    }
    if (!purchasedShop.trim()) {
      showStatus('Purchased shop or origin source is required', true);
      return;
    }
    for (const it of items) {
      if (!it.name.trim()) {
        showStatus('All items must have a name', true);
        return;
      }
      if (!it.price || Number(it.price) <= 0) {
        showStatus(`Please set a valid buying price for "${it.name}"`, true);
        return;
      }
    }

    setSaving(true);
    try {
      const invoicePayload = {
        customer_name: sellerName.trim(),
        customer_phone: sellerPhone.trim(),
        paid_cash: cashNum,
        transaction_type: 'used_purchase',
        return_reason: `Origin: ${purchasedShop.trim()}${notes ? ' | Notes: ' + notes.trim() : ''}`,
        items: items.map((it) => ({
          barcode: '',
          name: it.name.trim() + (it.model.trim() ? ` (${it.model.trim()})` : ''),
          price: Number(it.price),
          quantity: Number(it.qty) || 1,
          discount: 0,
          warranty: it.warranty,
        })),
      };

      const created = await saveInvoice(invoicePayload);
      showStatus('Used purchase recorded successfully!');

      if (printAfter && created) {
        try {
          await printReceipt(buildReceiptHTML(created));
        } catch (printErr: any) {
          showStatus('Saved, but print failed: ' + printErr.message, true);
        }
      }

      // Reset
      setSellerName('');
      setSellerPhone('');
      setPurchasedShop('');
      setNotes('');
      setPaidCash('');
      setItems([emptyItem()]);
    } catch (err: any) {
      showStatus(err.message || 'Failed to save used purchase', true);
    } finally {
      setSaving(false);
    }
  };

  const handleReprint = async (invoiceNo: string) => {
    setPrintingId(invoiceNo);
    try {
      const inv = await getInvoice(invoiceNo);
      await printReceipt(buildReceiptHTML(inv));
      showStatus('Receipt printed!');
    } catch (err: any) {
      showStatus('Print failed: ' + err.message, true);
    } finally {
      setPrintingId(null);
    }
  };

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Used Purchase (Buyback)</h1>
            <p className="text-sm text-gray-400">Buy second-hand devices or trade-ins from customers and record receipts</p>
          </div>

          <div className="flex bg-gray-800 rounded-lg p-0.5 border border-gray-700">
            <button
              onClick={() => setTab('new')}
              className={`px-4 py-1.5 rounded text-xs font-semibold transition-all ${tab === 'new' ? 'bg-indigo-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
            >
              + New Purchase
            </button>
            <button
              onClick={() => setTab('history')}
              className={`px-4 py-1.5 rounded text-xs font-semibold transition-all ${tab === 'history' ? 'bg-indigo-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
            >
              Purchase History
            </button>
          </div>
        </div>

        {/* Alerts */}
        {error && (
          <div className="p-3 bg-red-950/60 border border-red-800 text-red-300 rounded-lg text-sm animate-fadeIn">
            {error}
          </div>
        )}
        {statusMsg && (
          <div className="p-3 bg-green-950/60 border border-green-800 text-green-300 rounded-lg text-sm animate-fadeIn">
            {statusMsg}
          </div>
        )}

        {/* ── NEW USED PURCHASE TAB ──────────────────────────────────── */}
        {tab === 'new' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: Items list & Seller details */}
            <div className="lg:col-span-2 space-y-6">
              {/* Seller details card */}
              <div className="sv-card space-y-4">
                <h2 className="text-base font-semibold text-white border-b border-gray-800 pb-2">
                  Seller &amp; Device Origin
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="sv-label">Seller Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Kasun Silva"
                      value={sellerName}
                      onChange={(e) => setSellerName(e.target.value)}
                      className="sv-input"
                    />
                  </div>
                  <div>
                    <label className="sv-label">Seller Phone *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. 0771234567"
                      value={sellerPhone}
                      onChange={(e) => setSellerPhone(e.target.value)}
                      className="sv-input"
                    />
                  </div>
                  <div>
                    <label className="sv-label">Origin / Purchased Shop *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Singer / Dialcom"
                      value={purchasedShop}
                      onChange={(e) => setPurchasedShop(e.target.value)}
                      className="sv-input"
                    />
                  </div>
                </div>

                <div>
                  <label className="sv-label">Notes (IMEI / Condition / Accessories)</label>
                  <input
                    type="text"
                    placeholder="e.g. IMEI: 86452..., minor scratches, charger included"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="sv-input text-xs"
                  />
                </div>
              </div>

              {/* Items Card */}
              <div className="sv-card space-y-4">
                <div className="flex justify-between items-center border-b border-gray-800 pb-2">
                  <h2 className="text-base font-semibold text-white">Purchased Items</h2>
                  <button
                    type="button"
                    onClick={addItem}
                    className="sv-btn sv-btn-ghost py-1 px-2.5 text-xs text-indigo-400 hover:text-indigo-300"
                  >
                    + Add Item
                  </button>
                </div>

                <div className="space-y-3">
                  {items.map((item, idx) => (
                    <div
                      key={item.id}
                      className="p-3 bg-gray-900/80 border border-gray-800 rounded-xl space-y-3"
                    >
                      <div className="flex justify-between items-center text-xs text-gray-400">
                        <span className="font-semibold text-indigo-400">Item #{idx + 1}</span>
                        {items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeItem(item.id)}
                            className="text-red-400 hover:text-red-300"
                          >
                            Remove
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                        <div className="sm:col-span-4">
                          <label className="sv-label">Item Name *</label>
                          <input
                            type="text"
                            required
                            placeholder="e.g. iPhone 13 128GB"
                            value={item.name}
                            onChange={(e) => updateItem(item.id, 'name', e.target.value)}
                            className="sv-input"
                          />
                        </div>
                        <div className="sm:col-span-3">
                          <label className="sv-label">Model / Specs</label>
                          <input
                            type="text"
                            placeholder="e.g. Midnight Blue"
                            value={item.model}
                            onChange={(e) => updateItem(item.id, 'model', e.target.value)}
                            className="sv-input"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="sv-label">Buying Price *</label>
                          <input
                            type="number"
                            min="0"
                            placeholder="0.00"
                            value={item.price}
                            onChange={(e) =>
                              updateItem(
                                item.id,
                                'price',
                                e.target.value === '' ? '' : Number(e.target.value)
                              )
                            }
                            className="sv-input font-mono"
                          />
                        </div>
                        <div className="sm:col-span-1">
                          <label className="sv-label">Qty</label>
                          <input
                            type="number"
                            min="1"
                            value={item.qty}
                            onChange={(e) =>
                              updateItem(
                                item.id,
                                'qty',
                                Math.max(1, parseInt(e.target.value) || 1)
                              )
                            }
                            className="sv-input font-mono text-center"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="sv-label">Warranty</label>
                          <select
                            value={item.warranty}
                            onChange={(e) => updateItem(item.id, 'warranty', e.target.value)}
                            className="sv-input text-xs"
                          >
                            {WARRANTY_OPTIONS.map((w) => (
                              <option key={w} value={w}>
                                {w}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right: Payment & Summary */}
            <div className="lg:col-span-1">
              <div className="sv-card sticky top-4 space-y-5">
                <h2 className="text-base font-semibold text-white border-b border-gray-800 pb-2">
                  Payout Summary
                </h2>

                <div className="space-y-3 text-sm">
                  <div className="flex justify-between text-gray-400">
                    <span>Total Purchase Value:</span>
                    <span className="text-white font-bold font-mono">Rs. {fmt(subtotal)}</span>
                  </div>

                  <div>
                    <label className="sv-label">Cash Paid to Seller (Rs.)</label>
                    <input
                      type="number"
                      min="0"
                      placeholder={String(subtotal)}
                      value={paidCash}
                      onChange={(e) =>
                        setPaidCash(e.target.value === '' ? '' : Number(e.target.value))
                      }
                      className="sv-input text-lg font-bold font-mono text-emerald-400"
                    />
                  </div>

                  <div className="flex justify-between text-gray-400 pt-2 border-t border-gray-800">
                    <span>Remaining Balance:</span>
                    <span
                      className={`font-bold font-mono ${balance > 0 ? 'text-amber-400' : 'text-gray-300'}`}
                    >
                      Rs. {fmt(balance)}
                    </span>
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  <button
                    type="button"
                    disabled={saving || subtotal <= 0}
                    onClick={() => handleSubmit(true)}
                    className="sv-btn sv-btn-primary w-full py-2.5 font-medium flex items-center justify-center gap-2"
                  >
                    <span>🖨️</span>
                    <span>{saving ? 'Processing…' : 'Save & Print Receipt'}</span>
                  </button>

                  <button
                    type="button"
                    disabled={saving || subtotal <= 0}
                    onClick={() => handleSubmit(false)}
                    className="sv-btn sv-btn-ghost w-full py-2 text-xs"
                  >
                    Save Without Printing
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── PURCHASE HISTORY TAB ──────────────────────────────────── */}
        {tab === 'history' && (
          <div className="sv-card">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-base font-semibold text-white">Used Purchases Log</h2>
              <span className="text-xs text-gray-400">{history.length} records</span>
            </div>

            {loadingHistory ? (
              <div className="text-center py-12 text-gray-500 text-sm">Loading history…</div>
            ) : history.length === 0 ? (
              <div className="text-center py-12 text-gray-500 text-sm">
                No used purchases recorded yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="sv-table text-xs">
                  <thead>
                    <tr>
                      <th>Invoice No</th>
                      <th>Date</th>
                      <th>Seller / Contact</th>
                      <th>Items Bought</th>
                      <th className="text-right">Total Paid (Rs.)</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((inv: any) => {
                      const dateStr = inv.created_at
                        ? new Date(inv.created_at).toLocaleDateString()
                        : '—';
                      return (
                        <tr key={inv.invoice_no || inv._id} className="hover:bg-gray-800/40">
                          <td className="font-mono font-semibold text-indigo-400">
                            {inv.invoice_no}
                          </td>
                          <td className="text-gray-400 whitespace-nowrap">{dateStr}</td>
                          <td>
                            <div className="font-medium text-white">{inv.customer_name}</div>
                            <div className="text-[11px] text-gray-400 font-mono">
                              {inv.customer_phone}
                            </div>
                            {inv.return_reason && (
                              <div className="text-[10px] text-gray-500 italic mt-0.5">
                                {inv.return_reason}
                              </div>
                            )}
                          </td>
                          <td>
                            <div className="space-y-0.5">
                              {inv.items?.map((it: any, i: number) => (
                                <div key={i} className="text-gray-300">
                                  {it.name} <span className="text-gray-500 font-mono">x{it.quantity}</span>
                                  {it.warranty && (
                                    <span className="sv-badge sv-badge-purple ml-1.5 text-[9px]">
                                      {it.warranty}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </td>
                          <td className="text-right font-mono font-bold text-emerald-400">
                            Rs. {fmt(inv.total)}
                          </td>
                          <td className="space-x-1.5 whitespace-nowrap">
                            <button
                              onClick={() => openReceiptPreview(inv)}
                              className="sv-btn sv-btn-ghost py-1 px-2.5 text-[11px] text-indigo-400 hover:text-indigo-300"
                            >
                              View
                            </button>
                            <button
                              onClick={() => handleReprint(inv.invoice_no)}
                              disabled={printingId === inv.invoice_no}
                              className="sv-btn sv-btn-ghost py-1 px-2.5 text-[11px]"
                            >
                              {printingId === inv.invoice_no ? 'Printing…' : 'Reprint'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
