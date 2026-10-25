'use client';

import { useState, useEffect } from 'react';
import AppShell from '../components/AppShell';
import { getProducts, saveProduct, deleteProduct, generateBarcode, getCustomFields } from '@/lib/api';
import BarcodeVisual, { printBarcodeLabels } from '@/components/BarcodeVisual';

const PRODUCT_CATEGORIES = [
  '', 'Phone', 'Charger', 'Headphones', 'Laptop', 'Tablet', 'Smartwatch',
  'Speaker', 'Cable', 'Adapter', 'Power Bank', 'Keyboard', 'Mouse',
  'Monitor', 'Earbuds', 'Camera', 'Printer', 'Router', 'Other',
];

const fmt = (n: number) => (n || 0).toLocaleString('en', { minimumFractionDigits: 2 });

export default function ProductsPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [customFields, setCustomFields] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [statusType, setStatusType] = useState<'ok' | 'err'>('ok');

  // Modal states: 'none' | 'product' | 'barcode'
  const [modal, setModal] = useState<'none' | 'product' | 'barcode'>('none');
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [barcodeMode, setBarcodeMode] = useState<'auto' | 'manual'>('auto');
  const [generatingBarcode, setGeneratingBarcode] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');

  // Label Print Modal state
  const [labelProduct, setLabelProduct] = useState<any | null>(null);
  const [labelCopies, setLabelCopies] = useState<number>(1);
  const [labelSize, setLabelSize] = useState<'small' | 'medium' | 'large'>('medium');

  // Form state
  const [form, setForm] = useState({
    barcode: '', name: '', category: '', sku: '',
    price: '', quantity: '0', scan_mode: 'normal',
  });
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, any>>({});

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [prods, fields] = await Promise.all([getProducts(), getCustomFields()]);
      setProducts(prods);
      setCustomFields(Array.isArray(fields) ? fields : []);
      setError('');
    } catch (err: any) { setError(err.message || 'Failed to load'); }
    setLoading(false);
  };

  const showStatus = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setStatusMsg(msg);
    setStatusType(type);
    setTimeout(() => setStatusMsg(''), 3000);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!search.trim()) return loadAll();
    setLoading(true);
    try { setProducts(await getProducts({ search })); }
    catch (err: any) { setError(err.message || 'Search failed'); }
    setLoading(false);
  };

  const openNew = async () => {
    setBarcodeMode('auto');
    let bc = '';
    try {
      const g = await generateBarcode();
      // Ensure > 10 digits (12-digit standard)
      bc = g?.barcode && g.barcode.length > 10 ? g.barcode : String(200000000000 + Math.floor(Math.random() * 9000000000));
    } catch {
      bc = String(200000000000 + Math.floor(Math.random() * 9000000000));
    }
    setForm({ barcode: bc, name: '', category: '', sku: '', price: '', quantity: '0', scan_mode: 'normal' });
    setCustomFieldValues({});
    setEditingProduct(null);
    setModal('product');
  };

  const openEdit = (prod: any) => {
    setBarcodeMode('manual');
    setForm({
      barcode: prod.barcode, name: prod.name, category: prod.category || '',
      sku: prod.sku || '', price: String(prod.price), quantity: String(prod.quantity),
      scan_mode: prod.scan_mode || 'normal',
    });
    setCustomFieldValues(prod.custom_fields || {});
    setEditingProduct(prod);
    setModal('product');
  };

  const openLabelModal = (prod: any) => {
    setLabelProduct(prod);
    setLabelCopies(1);
    setLabelSize('medium');
    setModal('barcode');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.barcode.trim()) {
      showStatus('Barcode is required', 'err');
      return;
    }
    try {
      await saveProduct({
        _id: editingProduct?._id,
        barcode: form.barcode.trim(),
        name: form.name.trim(),
        category: form.category,
        sku: form.sku.trim(),
        price: parseFloat(form.price) || 0,
        quantity: parseInt(form.quantity) || 0,
        scan_mode: form.scan_mode,
        custom_fields: customFieldValues,
        __v: editingProduct?.__v,
      });
      showStatus(`✓ ${form.name} saved`);
      setModal('none');
      loadAll();
    } catch (err: any) { showStatus(err.message || 'Save failed', 'err'); }
  };

  const handleDelete = async (prod: any) => {
    if (!window.confirm(`Delete "${prod.name}"? This cannot be undone.`)) return;
    try {
      await deleteProduct(prod._id);
      setProducts(prev => prev.filter(p => p._id !== prod._id));
      showStatus(`Deleted: ${prod.name}`);
    } catch (err: any) { showStatus(err.message || 'Delete failed', 'err'); }
  };

  const handleTriggerPrintLabels = () => {
    if (!labelProduct || !labelProduct.barcode) return;
    printBarcodeLabels({
      barcode: labelProduct.barcode,
      name: labelProduct.name || '',
      price: Number(labelProduct.price) || 0,
      copies: labelCopies,
      size: labelSize,
    });
  };

  const outOfStockCount = products.filter(p => Number(p.quantity ?? 0) <= 0).length;

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto space-y-5">
        <div className="flex justify-between items-center flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-white">Products &amp; Inventory</h1>
            <p className="text-sm text-gray-400">Manage products, barcode labels, and stock levels</p>
          </div>
          <div className="flex items-center gap-2">
            {statusMsg && (
              <span className={`text-xs px-2.5 py-1 rounded ${statusType === 'ok' ? 'bg-green-950 text-green-300 border border-green-800' : 'bg-red-950 text-red-300 border border-red-800'}`}>
                {statusMsg}
              </span>
            )}
            <button onClick={openNew} className="sv-btn sv-btn-primary">
              + New Product
            </button>
          </div>
        </div>

        <div className="sv-card">
          <div className="flex justify-between items-center flex-wrap gap-3 mb-5">
            <form onSubmit={handleSearch} className="flex gap-2 flex-1 max-w-md">
              <input
                type="text" className="sv-input"
                placeholder="Search by name, barcode, category…"
                value={search} onChange={e => setSearch(e.target.value)}
              />
              <button type="submit" className="sv-btn sv-btn-primary">Search</button>
              {search && (
                <button type="button" onClick={() => { setSearch(''); loadAll(); }} className="sv-btn sv-btn-ghost">
                  Clear
                </button>
              )}
            </form>

            <div className="flex items-center gap-2 flex-wrap">
              {/* View mode toggle */}
              <div className="flex bg-gray-900 border border-gray-800 rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode('table')}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                    viewMode === 'table' ? 'bg-indigo-600 text-white shadow' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  📋 Table
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('cards')}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                    viewMode === 'cards' ? 'bg-indigo-600 text-white shadow' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  🏷️ Barcode Cards
                </button>
              </div>

              <a
                href="/barcode"
                className="sv-btn sv-btn-ghost text-xs text-indigo-400 border border-indigo-900/60 hover:bg-indigo-950/40"
              >
                🏷️ Barcode Creator →
              </a>

              {outOfStockCount > 0 && (
                <a
                  href="/out-of-stock"
                  className="sv-btn sv-btn-ghost text-xs text-red-400 border border-red-900/60 hover:bg-red-950/40"
                >
                  ⚠️ {outOfStockCount} Out of Stock
                </a>
              )}
            </div>
          </div>

          {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

          {viewMode === 'table' ? (
            <div className="overflow-x-auto">
              <table className="sv-table">
                <thead>
                  <tr>
                    <th>Barcode &amp; Visual</th>
                    <th>Name</th>
                    <th>Category</th>
                    <th className="text-right">Price</th>
                    <th className="text-right">Stock</th>
                    <th>Scan Mode</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={7} className="text-center py-8 text-gray-500">Loading products…</td></tr>
                  ) : products.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-8 text-gray-500">No products found</td></tr>
                  ) : products.map(prod => (
                    <tr key={prod._id} className="hover:bg-gray-800/40 transition-colors">
                      <td>
                        <div className="space-y-1">
                          <span className="font-mono text-indigo-300 text-xs font-semibold block">{prod.barcode}</span>
                          {/* Inline barcode visual */}
                          <div className="-my-1">
                            <BarcodeVisual value={prod.barcode} width={1.3} height={26} displayValue={false} className="p-1" />
                          </div>
                        </div>
                      </td>
                      <td className="font-medium text-white">{prod.name}</td>
                      <td className="text-sm text-gray-400">{prod.category || '—'}</td>
                      <td className="text-right text-sm font-mono font-semibold text-emerald-400">Rs. {fmt(prod.price)}</td>
                      <td className="text-right">
                        <span className={`sv-badge ${prod.quantity <= 0 ? 'sv-badge-red' : prod.quantity <= 5 ? 'sv-badge-yellow' : 'sv-badge-green'}`}>
                          {prod.quantity}
                        </span>
                      </td>
                      <td>
                        {prod.scan_mode === 'inventory_only'
                          ? <span className="sv-badge sv-badge-yellow">Inv Only</span>
                          : <span className="sv-badge sv-badge-blue">Normal</span>}
                      </td>
                      <td className="text-right whitespace-nowrap">
                        <div className="flex gap-1.5 justify-end">
                          <button
                            onClick={() => openLabelModal(prod)}
                            title="View Barcode and Print Alone Labels"
                            className="sv-btn sv-btn-ghost py-1 px-2.5 text-xs text-indigo-400 hover:text-indigo-300 font-semibold"
                          >
                            🏷️ Print Label
                          </button>
                          <button onClick={() => openEdit(prod)} className="sv-btn sv-btn-ghost py-1 px-2 text-xs">Edit</button>
                          <button onClick={() => handleDelete(prod)} className="sv-btn sv-btn-danger py-1 px-2 text-xs">Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            /* ── Barcode Cards View ── */
            loading ? (
              <div className="text-center py-12 text-gray-500">Loading products…</div>
            ) : products.length === 0 ? (
              <div className="text-center py-12 text-gray-500">No products found</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {products.map(prod => (
                  <div
                    key={prod._id}
                    className="bg-gray-950 border border-gray-800 hover:border-indigo-500/60 rounded-xl p-3 flex flex-col justify-between transition-all hover:-translate-y-0.5"
                  >
                    <div className="bg-white p-2 rounded-lg flex items-center justify-center min-h-[58px]">
                      <BarcodeVisual
                        value={prod.barcode}
                        width={1.2}
                        height={34}
                        fontSize={10}
                        displayValue={true}
                        className="p-0 shadow-none"
                      />
                    </div>
                    <div className="mt-2.5 space-y-1">
                      <div className="font-semibold text-xs text-white truncate" title={prod.name}>
                        {prod.name}
                      </div>
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="font-mono font-bold text-emerald-400">Rs. {fmt(prod.price)}</span>
                        <span className={`sv-badge text-[10px] ${prod.quantity <= 0 ? 'sv-badge-red' : 'sv-badge-green'}`}>
                          Qty: {prod.quantity}
                        </span>
                      </div>
                      <div className="flex gap-1 pt-1.5 border-t border-gray-800/80">
                        <button
                          type="button"
                          onClick={() => openLabelModal(prod)}
                          className="sv-btn sv-btn-ghost py-1 px-1.5 text-[11px] text-indigo-400 hover:text-indigo-300 flex-1 font-semibold"
                        >
                          🏷️ Print
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(prod)}
                          className="sv-btn sv-btn-ghost py-1 px-1.5 text-[11px] text-gray-300 hover:text-white flex-1"
                        >
                          Edit
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>

      {/* ── Product Editor Modal (with Live Barcode Visual) ── */}
      {modal === 'product' && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 animate-fadeIn" onClick={e => { if (e.target === e.currentTarget) setModal('none'); }}>
          <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-xl max-h-[92vh] overflow-y-auto shadow-2xl">
            <div className="p-5 border-b border-gray-800 flex justify-between items-center">
              <h2 className="text-lg font-bold text-white">{editingProduct ? 'Edit Product' : 'New Product'}</h2>
              <button onClick={() => setModal('none')} className="text-gray-500 hover:text-white text-xl leading-none">✕</button>
            </div>
            <form onSubmit={handleSave} className="p-5 space-y-4">
              {/* Barcode section with auto-generator */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="sv-label mb-0">Barcode Number (12 Digits) *</label>
                  <button
                    type="button"
                    onClick={() => setBarcodeMode(barcodeMode === 'auto' ? 'manual' : 'auto')}
                    className="text-xs text-indigo-400 hover:text-indigo-300 underline"
                  >
                    {barcodeMode === 'auto' ? 'Switch to Manual Entry' : 'Switch to Auto-Generated'}
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    required
                    className="sv-input font-mono flex-1 text-sm tracking-wider"
                    placeholder="12-digit barcode"
                    value={form.barcode}
                    readOnly={barcodeMode === 'auto' && !editingProduct}
                    onChange={e => setForm(f => ({ ...f, barcode: e.target.value }))}
                  />
                  <button
                    type="button"
                    disabled={generatingBarcode}
                    title="Auto-generate a new unique 12-digit barcode"
                    onClick={async () => {
                      setGeneratingBarcode(true);
                      try {
                        const g = await generateBarcode();
                        const bc = g?.barcode || String(200000000000 + Math.floor(Math.random() * 9000000000));
                        setForm(f => ({ ...f, barcode: bc }));
                        setBarcodeMode('auto');
                      } catch {
                        setForm(f => ({ ...f, barcode: String(200000000000 + Math.floor(Math.random() * 9000000000)) }));
                      } finally {
                        setGeneratingBarcode(false);
                      }
                    }}
                    className="sv-btn sv-btn-ghost text-xs px-3 whitespace-nowrap"
                  >
                    {generatingBarcode ? '…' : '↻ Auto Assign'}
                  </button>
                </div>
                <p className="text-[11px] text-gray-500 mt-1">
                  {barcodeMode === 'auto'
                    ? '⚡ Unique 12-digit barcode auto-assigned for this product.'
                    : '✏️ Enter or scan the manufacturer barcode number.'}
                </p>
              </div>

              {/* ── LIVE BARCODE VISUAL PREVIEW CARD ── */}
              <div className="bg-gray-950 p-4 rounded-xl border border-gray-800 text-center space-y-2">
                <div className="text-[11px] uppercase tracking-wider text-gray-400 font-bold">
                  Barcode Visual Preview
                </div>
                {form.name && (
                  <div className="text-xs font-bold text-white uppercase tracking-tight truncate max-w-xs mx-auto">
                    {form.name}
                  </div>
                )}
                <div className="flex justify-center">
                  <BarcodeVisual
                    value={form.barcode}
                    width={1.8}
                    height={46}
                    fontSize={12}
                    className="bg-white px-4 py-2"
                  />
                </div>
                {form.price && (
                  <div className="text-xs font-mono font-bold text-emerald-400">
                    Rs. {fmt(parseFloat(form.price) || 0)}
                  </div>
                )}
              </div>

              <div>
                <label className="sv-label">Product Name *</label>
                <input required className="sv-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Samsung Galaxy A15" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="sv-label">Category</label>
                  <select className="sv-input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                    {PRODUCT_CATEGORIES.map(c => <option key={c} value={c}>{c || '— None —'}</option>)}
                  </select>
                </div>
                <div>
                  <label className="sv-label">SKU</label>
                  <input className="sv-input" value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} placeholder="e.g. SAM-A15-BLU" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="sv-label">Price (Rs) *</label>
                  <input required type="number" min="0" step="0.01" className="sv-input font-mono" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} placeholder="0.00" />
                </div>
                <div>
                  <label className="sv-label">Quantity *</label>
                  <input required type="number" min="0" className="sv-input font-mono" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="sv-label">Scan Mode</label>
                <select className="sv-input" value={form.scan_mode} onChange={e => setForm(f => ({ ...f, scan_mode: e.target.value }))}>
                  <option value="normal">Normal (POS + Inventory)</option>
                  <option value="inventory_only">Inventory Only (not for sale)</option>
                </select>
              </div>

              {/* Custom fields */}
              {customFields.length > 0 && (
                <div className="space-y-3 pt-2 border-t border-gray-800">
                  <p className="text-xs text-gray-500 uppercase font-semibold tracking-wide">Custom Fields</p>
                  {customFields.map((f: any) => (
                    <div key={f._id}>
                      <label className="sv-label">{f.label}</label>
                      <input
                        className="sv-input"
                        value={customFieldValues[f.key] ?? ''}
                        onChange={e => setCustomFieldValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2 justify-end pt-3 border-t border-gray-800">
                <button type="button" onClick={() => setModal('none')} className="sv-btn sv-btn-ghost">Cancel</button>
                <button type="submit" className="sv-btn sv-btn-primary">Save Product</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── STANDALONE BARCODE LABEL PRINT MODAL (like Electron App) ── */}
      {modal === 'barcode' && labelProduct && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4 animate-fadeIn" onClick={e => { if (e.target === e.currentTarget) setModal('none'); }}>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-5">
            <div className="flex justify-between items-center border-b border-gray-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">Barcode Label Print</h3>
                <p className="text-xs text-gray-400">Print barcode label with product name &amp; price</p>
              </div>
              <button onClick={() => setModal('none')} className="text-gray-400 hover:text-white text-xl">✕</button>
            </div>

            {/* Visual Label Preview */}
            <div className="bg-gray-950 p-5 rounded-xl border border-gray-800 text-center space-y-3">
              <div className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">
                Label Layout Preview
              </div>

              <div className="inline-flex flex-col items-center bg-white text-black p-4 rounded-xl shadow-lg border border-gray-300 max-w-xs mx-auto">
                <div className="text-xs font-bold uppercase tracking-tight text-black max-w-[200px] truncate mb-1">
                  {labelProduct.name || 'Product'}
                </div>
                <BarcodeVisual
                  value={labelProduct.barcode}
                  width={labelSize === 'small' ? 1.4 : labelSize === 'large' ? 2.2 : 1.8}
                  height={labelSize === 'small' ? 36 : labelSize === 'large' ? 60 : 48}
                  fontSize={11}
                  className="p-1"
                />
                <div className="text-xs font-extrabold text-black mt-1 font-mono">
                  Rs. {fmt(labelProduct.price)}
                </div>
              </div>
            </div>

            {/* Label Print Options */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="sv-label">Label Size</label>
                <select
                  value={labelSize}
                  onChange={(e) => setLabelSize(e.target.value as any)}
                  className="sv-input"
                >
                  <option value="small">Small (35×22 mm)</option>
                  <option value="medium">Medium (55×35 mm)</option>
                  <option value="large">Large (75×48 mm)</option>
                </select>
              </div>

              <div>
                <label className="sv-label">Copies</label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={labelCopies}
                  onChange={(e) => setLabelCopies(Math.max(1, parseInt(e.target.value) || 1))}
                  className="sv-input font-mono text-center font-bold"
                />
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 pt-2 border-t border-gray-800">
              <button
                type="button"
                onClick={() => setModal('none')}
                className="sv-btn sv-btn-ghost flex-1 text-xs"
              >
                Close
              </button>
              <button
                type="button"
                onClick={handleTriggerPrintLabels}
                className="sv-btn sv-btn-primary flex-1 text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                <span>🖨️</span>
                <span>Print {labelCopies} {labelCopies === 1 ? 'Label' : 'Labels'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
