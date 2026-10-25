'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import AppShell from '../components/AppShell';
import { getProduct, saveInvoice, getUser } from '@/lib/api';
import { printReceipt, buildReceiptHTML, openReceiptPreview } from '@/lib/print';

interface CartItem {
  barcode: string;
  name: string;
  price: number;
  quantity: number;
  discount: number;
  net_price: number;
  total: number;
  warranty: string;
  remaining_warranty: string;
}

const WARRANTY_OPTIONS = ['No warranty', '7 days', '1 month', '3 months', '6 months', '1 year', '2 years', '3 years', '5 years'];

export default function POSPage() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [scanInput, setScanInput] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [paidCash, setPaidCash] = useState('');
  const [txMode, setTxMode] = useState<'sale' | 'customer_return' | 'supplier_return'>('sale');
  const [returnReason, setReturnReason] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [statusType, setStatusType] = useState<'ok' | 'err'>('ok');
  const [saving, setSaving] = useState(false);
  const [lastInvoice, setLastInvoice] = useState<any>(null);
  const [selectedPrinter, setSelectedPrinter] = useState('');
  const scanRef = useRef<HTMLInputElement>(null);

  const user = getUser();

  const showStatus = useCallback((msg: string, type: 'ok' | 'err' = 'ok') => {
    setStatusMsg(msg);
    setStatusType(type);
    setTimeout(() => setStatusMsg(''), 3500);
  }, []);

  // Keep scan input focused at all times
  useEffect(() => {
    const refocus = () => scanRef.current?.focus();
    document.addEventListener('click', refocus);
    return () => document.removeEventListener('click', refocus);
  }, []);

  useEffect(() => {
    scanRef.current?.focus();
  }, []);

  // ── Cart helpers ──────────────────────────────────────────────────────────

  const addToCart = useCallback(async (barcode: string) => {
    if (!barcode.trim()) return;
    try {
      const product = await getProduct(barcode.trim());
      if (!product) { showStatus(`Product "${barcode}" not found`, 'err'); return; }
      if (product.scan_mode === 'inventory_only') {
        showStatus(`"${product.name}" is inventory-only — not for sale`, 'err');
        return;
      }

      setCart((prev) => {
        const existing = prev.find((i) => i.barcode === product.barcode);
        if (existing) {
          return prev.map((i) =>
            i.barcode === product.barcode
              ? { ...i, quantity: i.quantity + 1, total: (i.quantity + 1) * i.net_price }
              : i,
          );
        }
        const newItem: CartItem = {
          barcode: product.barcode,
          name: product.name,
          price: product.price,
          quantity: 1,
          discount: 0,
          net_price: product.price,
          total: product.price,
          warranty: txMode === 'sale' ? 'No warranty' : '',
          remaining_warranty: '',
        };
        return [...prev, newItem];
      });
      showStatus(`✓ ${product.name}`);
    } catch (err: any) {
      showStatus(err.message || `Not found: ${barcode}`, 'err');
    }
  }, [txMode, showStatus]);

  const handleScanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await addToCart(scanInput);
    setScanInput('');
  };

  const updateItem = (barcode: string, field: keyof CartItem, value: any) => {
    setCart((prev) =>
      prev.map((i) => {
        if (i.barcode !== barcode) return i;
        const updated = { ...i, [field]: value };
        if (field === 'quantity' || field === 'discount') {
          const net = updated.price - (updated.discount || 0);
          updated.net_price = net;
          updated.total = net * updated.quantity;
        }
        return updated;
      }).filter((i) => i.quantity > 0),
    );
  };

  const removeItem = (barcode: string) => setCart((p) => p.filter((i) => i.barcode !== barcode));

  // ── Totals ────────────────────────────────────────────────────────────────

  const isReturn = txMode !== 'sale';
  const subtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const totalDiscount = isReturn ? 0 : cart.reduce((s, i) => s + i.discount * i.quantity, 0);
  const total = subtotal - totalDiscount;
  const balance = isReturn ? 0 : total - (parseFloat(paidCash) || 0);
  const fmt = (n: number) => n.toLocaleString('en', { minimumFractionDigits: 2 });

  // ── Save & Print ──────────────────────────────────────────────────────────

  const handleSave = async (withPrint = false) => {
    if (cart.length === 0) { showStatus('Cart is empty', 'err'); return; }
    setSaving(true);
    try {
      const invoice = await saveInvoice({
        customer_name: customerName.trim() || undefined,
        customer_phone: customerPhone.trim() || undefined,
        paid_cash: isReturn ? 0 : parseFloat(paidCash) || 0,
        transaction_type: txMode,
        return_reason: returnReason.trim() || undefined,
        items: cart,
      });

      setLastInvoice(invoice);
      showStatus(`✓ Invoice ${invoice.invoice_no} saved`);

      if (withPrint) {
        try {
          await printReceipt(buildReceiptHTML(invoice), selectedPrinter || undefined);
        } catch {
          showStatus('Saved — but print failed (is QZ Tray running?)', 'err');
        }
      }

      // Reset
      setCart([]);
      setCustomerName('');
      setCustomerPhone('');
      setPaidCash('');
      setReturnReason('');
      scanRef.current?.focus();
    } catch (err: any) {
      showStatus(err.message || 'Save failed', 'err');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-3 mb-5">
          <h1 className="text-xl font-bold text-white">Point of Sale</h1>
          {/* Transaction mode tabs */}
          {(['sale', 'customer_return', 'supplier_return'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setTxMode(mode)}
              className={`sv-btn text-xs py-1 px-3 ${txMode === mode ? 'sv-btn-primary' : 'sv-btn-ghost'}`}
            >
              {mode === 'sale' ? 'Sale' : mode === 'customer_return' ? 'Customer Return' : 'Supplier Return'}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* ── Left: Scan + Cart ──────────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-4">
            {/* Scan bar */}
            <div className="sv-card">
              <form onSubmit={handleScanSubmit} className="flex gap-2">
                <input
                  ref={scanRef}
                  type="text"
                  className="sv-input flex-1 text-base font-mono"
                  placeholder="Scan barcode or type and press Enter…"
                  value={scanInput}
                  onChange={(e) => setScanInput(e.target.value)}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <button type="submit" className="sv-btn sv-btn-primary px-5">Add</button>
              </form>
              {statusMsg && (
                <p className={`mt-2 text-sm ${statusType === 'err' ? 'text-red-400' : 'text-green-400'}`}>
                  {statusMsg}
                </p>
              )}
            </div>

            {/* Cart */}
            <div className="sv-card p-0 overflow-hidden">
              {cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-gray-600">
                  <svg className="w-10 h-10 mb-2 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <path d="M3 9l4-4m0 0l4 4m-4-4v12m10-8l4 4m0 0l-4 4m4-4H9"/>
                  </svg>
                  <p>Cart is empty — scan a product to start</p>
                </div>
              ) : (
                <table className="sv-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th className="text-center w-24">Qty</th>
                      <th className="text-right w-24">Price</th>
                      {!isReturn && <th className="text-right w-24">Discount</th>}
                      <th className="text-right w-24">Total</th>
                      {txMode === 'sale' && <th className="w-32">Warranty</th>}
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map((item) => (
                      <tr key={item.barcode}>
                        <td>
                          <div className="font-medium text-white">{item.name}</div>
                          <div className="text-xs text-gray-500 font-mono">{item.barcode}</div>
                        </td>
                        <td>
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => updateItem(item.barcode, 'quantity', item.quantity - 1)} className="sv-btn sv-btn-ghost w-7 h-7 p-0 text-lg">−</button>
                            <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                            <button onClick={() => updateItem(item.barcode, 'quantity', item.quantity + 1)} className="sv-btn sv-btn-ghost w-7 h-7 p-0 text-lg">+</button>
                          </div>
                        </td>
                        <td className="text-right text-sm">{fmt(item.price)}</td>
                        {!isReturn && (
                          <td className="text-right">
                            <input
                              type="number"
                              min="0"
                              className="sv-input text-right text-sm py-1 px-2"
                              value={item.discount || ''}
                              onChange={(e) => updateItem(item.barcode, 'discount', parseFloat(e.target.value) || 0)}
                              placeholder="0"
                            />
                          </td>
                        )}
                        <td className="text-right text-sm font-medium">{fmt(item.total)}</td>
                        {txMode === 'sale' && (
                          <td>
                            <select
                              className="sv-input text-xs py-1 px-2"
                              value={item.warranty}
                              onChange={(e) => updateItem(item.barcode, 'warranty', e.target.value)}
                            >
                              {WARRANTY_OPTIONS.map((w) => <option key={w}>{w}</option>)}
                            </select>
                          </td>
                        )}
                        <td>
                          <button onClick={() => removeItem(item.barcode)} className="sv-btn sv-btn-ghost w-7 h-7 p-0 text-red-400 hover:text-red-300">✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* ── Right: Customer + Payment ──────────────────────────────────── */}
          <div className="space-y-4">
            {/* Customer */}
            <div className="sv-card space-y-3">
              <h2 className="text-sm font-semibold text-gray-300">Customer</h2>
              <div>
                <label className="sv-label">Name</label>
                <input className="sv-input" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Optional" />
              </div>
              <div>
                <label className="sv-label">Phone</label>
                <input className="sv-input" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="Optional" />
              </div>
              {isReturn && (
                <div>
                  <label className="sv-label">Return Reason</label>
                  <input className="sv-input" value={returnReason} onChange={(e) => setReturnReason(e.target.value)} placeholder="e.g. Defective, Wrong item" />
                </div>
              )}
            </div>

            {/* Totals */}
            <div className="sv-card space-y-2">
              <div className="flex justify-between text-sm text-gray-400">
                <span>Subtotal</span><span>{fmt(subtotal)}</span>
              </div>
              {!isReturn && totalDiscount > 0 && (
                <div className="flex justify-between text-sm text-yellow-400">
                  <span>Discount</span><span>−{fmt(totalDiscount)}</span>
                </div>
              )}
              <div className="flex justify-between text-lg font-bold text-white border-t border-gray-700 pt-2">
                <span>TOTAL</span><span>{fmt(total)}</span>
              </div>
              {!isReturn && (
                <>
                  <div>
                    <label className="sv-label">Cash Received</label>
                    <input
                      type="number"
                      className="sv-input text-right text-base"
                      min="0"
                      value={paidCash}
                      onChange={(e) => setPaidCash(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  <div className={`flex justify-between text-sm font-medium ${balance > 0 ? 'text-red-400' : 'text-green-400'}`}>
                    <span>{balance > 0 ? 'Balance Due' : 'Change'}</span>
                    <span>{fmt(Math.abs(balance))}</span>
                  </div>
                </>
              )}
            </div>

            {/* Actions */}
            <div className="space-y-2">
              <button
                onClick={() => handleSave(true)}
                disabled={saving || cart.length === 0}
                className="sv-btn sv-btn-primary w-full py-3 text-base"
              >
                {saving ? 'Saving…' : '🖨 Save & Print'}
              </button>
              <button
                onClick={() => handleSave(false)}
                disabled={saving || cart.length === 0}
                className="sv-btn sv-btn-ghost w-full"
              >
                Save Only
              </button>
              <button
                onClick={() => { setCart([]); setScanInput(''); }}
                className="sv-btn sv-btn-ghost w-full text-red-400 border-red-900"
              >
                Clear Cart
              </button>
            </div>

            {/* Last invoice quick-view */}
            {lastInvoice && (
              <div className="sv-card text-xs text-gray-400 space-y-2 animate-fadeIn">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-gray-200">Last Invoice</span>
                  <span className="sv-badge sv-badge-green">{lastInvoice.status}</span>
                </div>
                <div className="font-mono text-indigo-300 font-bold">{lastInvoice.invoice_no}</div>
                <div>Total: <span className="text-white font-bold">Rs. {fmt(lastInvoice.total)}</span></div>
                <div className="flex gap-2 pt-1 border-t border-gray-800">
                  <button
                    type="button"
                    onClick={() => openReceiptPreview(lastInvoice)}
                    className="sv-btn sv-btn-ghost py-1 px-2.5 text-xs text-indigo-400 hover:text-indigo-300 flex-1"
                  >
                    👁 View Receipt
                  </button>
                  <button
                    type="button"
                    onClick={() => printReceipt(buildReceiptHTML(lastInvoice), selectedPrinter || undefined)}
                    className="sv-btn sv-btn-ghost py-1 px-2.5 text-xs flex-1"
                  >
                    🖨️ Reprint
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
