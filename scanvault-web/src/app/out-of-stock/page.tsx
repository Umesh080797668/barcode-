'use client';

import { useState, useEffect, useCallback } from 'react';
import AppShell from '../components/AppShell';
import { getProducts, saveProduct } from '@/lib/api';

const fmt = (n: number) => (n || 0).toLocaleString('en', { minimumFractionDigits: 2 });

export default function OutOfStockPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusMsg, setStatusMsg] = useState('');

  // Quick Restock Modal
  const [restockItem, setRestockItem] = useState<any | null>(null);
  const [restockQty, setRestockQty] = useState<number>(1);
  const [restocking, setRestocking] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const all = await getProducts();
      // Filter out products with quantity <= 0
      const list = Array.isArray(all) ? all : (all?.products || []);
      const zeroQty = list.filter((p: any) => Number(p.quantity ?? 0) <= 0);
      setProducts(zeroQty);
      setError('');
    } catch (err: any) {
      setError(err.message || 'Failed to load out-of-stock products');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const showStatus = (msg: string) => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(''), 3500);
  };

  const handleQuickRestock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restockItem) return;
    if (restockQty <= 0) return;

    setRestocking(true);
    try {
      await saveProduct({
        _id: restockItem._id,
        barcode: restockItem.barcode,
        name: restockItem.name,
        price: restockItem.price,
        quantity: restockQty,
        category: restockItem.category,
        sku: restockItem.sku,
        scan_mode: restockItem.scan_mode,
        custom_fields: restockItem.custom_fields,
        __v: restockItem.__v,
      });
      showStatus(`✓ ${restockItem.name} restocked with ${restockQty} units!`);
      setRestockItem(null);
      setRestockQty(1);
      await loadData();
    } catch (err: any) {
      alert('Failed to restock: ' + (err.message || 'Unknown error'));
    } finally {
      setRestocking(false);
    }
  };

  const filtered = products.filter((p) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (p.name && p.name.toLowerCase().includes(q)) ||
      (p.barcode && p.barcode.toLowerCase().includes(q)) ||
      (p.category && p.category.toLowerCase().includes(q))
    );
  });

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-red-950/60 border border-red-800 flex items-center justify-center text-2xl shadow-inner">
              ⚠️
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-white tracking-tight">Out of Stock</h1>
                <span className="sv-badge sv-badge-red text-xs px-2.5 py-0.5 font-bold">
                  {products.length} {products.length === 1 ? 'item' : 'items'}
                </span>
              </div>
              <p className="text-sm text-gray-400">Products with 0 quantity that need restocking</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => loadData()}
              disabled={loading}
              className="sv-btn sv-btn-ghost text-xs"
            >
              {loading ? 'Refreshing…' : '↻ Refresh Stock'}
            </button>
          </div>
        </div>

        {/* Status Message */}
        {statusMsg && (
          <div className="p-3 bg-green-950/60 border border-green-800 text-green-300 rounded-lg text-sm animate-fadeIn">
            {statusMsg}
          </div>
        )}
        {error && (
          <div className="p-3 bg-red-950/60 border border-red-800 text-red-300 rounded-lg text-sm animate-fadeIn">
            {error}
          </div>
        )}

        {/* Content Card */}
        <div className="sv-card space-y-4">
          <div className="flex justify-between items-center flex-wrap gap-3">
            <div className="flex items-center gap-2 max-w-sm w-full">
              <input
                type="text"
                className="sv-input text-xs"
                placeholder="Search out-of-stock items…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="sv-btn sv-btn-ghost text-xs py-1.5 px-2.5"
                >
                  Clear
                </button>
              )}
            </div>
            <span className="text-xs text-gray-400">
              Showing {filtered.length} of {products.length} out-of-stock items
            </span>
          </div>

          {loading ? (
            <div className="text-center py-16 text-gray-500 text-sm">Checking inventory…</div>
          ) : products.length === 0 ? (
            <div className="text-center py-16 space-y-3">
              <div className="text-4xl">✅</div>
              <h2 className="text-lg font-bold text-white">All products are in stock!</h2>
              <p className="text-sm text-gray-400 max-w-md mx-auto">
                No products with zero quantity found in your store inventory.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-gray-500 text-sm">
              No out-of-stock products matching &quot;{search}&quot;.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="sv-table text-xs">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Barcode</th>
                    <th>Product Name</th>
                    <th>Category</th>
                    <th className="text-right">Price</th>
                    <th className="text-center">Current Stock</th>
                    <th>Last Scanned/Updated</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((prod, idx) => {
                    const id = prod._id || prod.id;
                    const dateStr = prod.updated_at || prod.created_at
                      ? new Date(prod.updated_at || prod.created_at).toLocaleDateString()
                      : '—';

                    return (
                      <tr key={id} className="hover:bg-gray-800/40 transition-colors">
                        <td className="text-gray-500 font-mono">{idx + 1}</td>
                        <td className="font-mono font-medium text-indigo-300">{prod.barcode}</td>
                        <td className="font-semibold text-white">{prod.name}</td>
                        <td className="text-gray-400">{prod.category || '—'}</td>
                        <td className="text-right font-mono text-gray-300">Rs. {fmt(prod.price)}</td>
                        <td className="text-center">
                          <span className="sv-badge sv-badge-red font-bold">
                            OUT OF STOCK (0)
                          </span>
                        </td>
                        <td className="text-gray-400 whitespace-nowrap">{dateStr}</td>
                        <td className="text-right">
                          <button
                            onClick={() => {
                              setRestockItem(prod);
                              setRestockQty(10);
                            }}
                            className="sv-btn sv-btn-primary py-1 px-3 text-xs"
                          >
                            + Quick Restock
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

        {/* ── Quick Restock Modal ────────────────────────────────────── */}
        {restockItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
            <div className="sv-card max-w-sm w-full shadow-2xl space-y-4">
              <div className="flex justify-between items-center border-b border-gray-800 pb-3">
                <h3 className="text-base font-semibold text-white">Quick Restock</h3>
                <button
                  onClick={() => setRestockItem(null)}
                  className="text-gray-400 hover:text-white text-lg font-bold"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-1 text-xs text-gray-400">
                <div>Product: <span className="font-semibold text-white">{restockItem.name}</span></div>
                <div>Barcode: <code className="text-indigo-400">{restockItem.barcode}</code></div>
                <div>Price: <span className="text-gray-300">Rs. {fmt(restockItem.price)}</span></div>
              </div>

              <form onSubmit={handleQuickRestock} className="space-y-4">
                <div>
                  <label className="sv-label">New Stock Quantity *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={restockQty}
                    onChange={(e) => setRestockQty(Math.max(1, parseInt(e.target.value) || 1))}
                    className="sv-input font-mono text-center text-lg font-bold text-green-400"
                    autoFocus
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-gray-800">
                  <button
                    type="button"
                    onClick={() => setRestockItem(null)}
                    className="sv-btn sv-btn-ghost text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={restocking}
                    className="sv-btn sv-btn-primary text-xs"
                  >
                    {restocking ? 'Updating…' : 'Confirm Restock'}
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
