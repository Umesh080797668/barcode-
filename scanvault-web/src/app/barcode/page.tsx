'use client';

import { useState, useEffect, useRef } from 'react';
import AppShell from '../components/AppShell';
import BarcodeVisual, { printBarcodeLabels } from '@/components/BarcodeVisual';
import {
  getProducts,
  saveProduct,
  deleteProduct,
  generateBarcode,
  getCustomFields,
  saveCustomField,
  deleteCustomField,
} from '@/lib/api';

const PRODUCT_MODALS = [
  '', 'Phone', 'Charger', 'Headphones', 'Laptop', 'Tablet', 'Smartwatch',
  'Speaker', 'Cable', 'Adapter', 'Power Bank', 'Keyboard', 'Mouse',
  'Monitor', 'Earbuds', 'Camera', 'Printer', 'Router', 'Other',
];

const fmtPrice = (val: any) => {
  const num = parseFloat(val) || 0;
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function BarcodeCreatorPage() {
  const [activeTab, setActiveTab] = useState<'products' | 'fields'>('products');
  const [view, setView] = useState<'list' | 'editor'>('list');

  const [products, setProducts] = useState<any[]>([]);
  const [customFields, setCustomFields] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);

  // Editor state
  const [editingProduct, setEditingProduct] = useState<any | null>(null);
  const [barcodeMode, setBarcodeMode] = useState<'auto' | 'manual'>('auto');
  const [generatingBarcode, setGeneratingBarcode] = useState(false);
  const [form, setForm] = useState<any>({
    barcode: '',
    name: '',
    category: '',
    sku: '',
    price: '',
    quantity: '0',
    scan_mode: 'normal',
    custom_fields: {},
  });

  // Standalone print options
  const [printQty, setPrintQty] = useState<number>(1);
  const [labelSize, setLabelSize] = useState<'small' | 'medium' | 'large'>('medium');

  // Custom field creation
  const [newField, setNewField] = useState({ label: '', field_type: 'text', default_val: '' });

  useEffect(() => {
    loadAll();
  }, []);

  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadAll = async () => {
    setLoading(true);
    try {
      const [prods, fields] = await Promise.all([getProducts(), getCustomFields()]);
      setProducts(Array.isArray(prods) ? prods : []);
      setCustomFields(Array.isArray(fields) ? fields : []);
    } catch (err: any) {
      showToast(err.message || 'Failed to load data', 'err');
    }
    setLoading(false);
  };

  const totalQty = products.reduce((acc, p) => acc + (Number(p.quantity) || 0), 0);

  const filteredProducts = products.filter((p) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (p.barcode || '').toLowerCase().includes(q) ||
      (p.name || '').toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q) ||
      (p.category || '').toLowerCase().includes(q)
    );
  });

  // Open Create Product
  const handleNewBarcode = async () => {
    setGeneratingBarcode(true);
    let bc = '';
    try {
      const res = await generateBarcode();
      // Ensure strictly > 10 digits (12-digit standard)
      bc = res?.barcode && res.barcode.length > 10 ? res.barcode : String(200000000000 + Math.floor(Math.random() * 9000000000));
    } catch {
      bc = String(200000000000 + Math.floor(Math.random() * 9000000000));
    }
    setGeneratingBarcode(false);

    setForm({
      barcode: bc,
      name: '',
      category: '',
      sku: '',
      price: '',
      quantity: '1',
      scan_mode: 'normal',
      custom_fields: {},
    });
    setEditingProduct(null);
    setBarcodeMode('auto');
    setPrintQty(1);
    setView('editor');
  };

  // Open Edit Product
  const handleSelectProduct = (prod: any) => {
    setEditingProduct(prod);
    setForm({
      barcode: prod.barcode || '',
      name: prod.name || '',
      category: prod.category || '',
      sku: prod.sku || '',
      price: String(prod.price ?? ''),
      quantity: String(prod.quantity ?? '0'),
      scan_mode: prod.scan_mode || 'normal',
      custom_fields: prod.custom_fields || {},
    });
    setBarcodeMode('manual');
    setPrintQty(1);
    setView('editor');
  };

  // Regenerate barcode (strictly > 10 digits)
  const handleRegenerateBarcode = async () => {
    setGeneratingBarcode(true);
    try {
      const res = await generateBarcode();
      const bc = res?.barcode && res.barcode.length > 10 ? res.barcode : String(200000000000 + Math.floor(Math.random() * 9000000000));
      setForm((prev: any) => ({ ...prev, barcode: bc }));
    } catch {
      setForm((prev: any) => ({ ...prev, barcode: String(200000000000 + Math.floor(Math.random() * 9000000000)) }));
    }
    setGeneratingBarcode(false);
  };

  // Save product
  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!form.barcode.trim()) {
      showToast('Barcode number is required', 'err');
      return;
    }
    if (form.barcode.trim().length <= 10) {
      showToast('Barcode number must be longer than 10 digits (12 digits recommended)', 'err');
    }
    if (!form.name.trim()) {
      showToast('Product name is required', 'err');
      return;
    }

    setSaving(true);
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
        custom_fields: form.custom_fields,
        __v: editingProduct?.__v,
      });
      showToast('✓ Product saved successfully');
      await loadAll();
      setView('list');
    } catch (err: any) {
      showToast(err.message || 'Failed to save product', 'err');
    }
    setSaving(false);
  };

  // Delete product
  const handleDelete = async () => {
    if (!editingProduct?._id) return;
    if (!window.confirm(`Delete product "${editingProduct.name}"?`)) return;
    try {
      await deleteProduct(editingProduct._id);
      showToast('Product deleted');
      await loadAll();
      setView('list');
    } catch (err: any) {
      showToast(err.message || 'Delete failed', 'err');
    }
  };

  // Standalone Barcode Print
  const handlePrint = () => {
    if (!form.barcode) {
      showToast('No barcode to print', 'err');
      return;
    }
    printBarcodeLabels({
      barcode: form.barcode,
      name: form.name,
      price: parseFloat(form.price) || 0,
      copies: printQty,
      size: labelSize,
    });
  };

  // Custom fields
  const handleSaveField = async () => {
    if (!newField.label.trim()) {
      showToast('Field label required', 'err');
      return;
    }
    try {
      await saveCustomField(newField);
      showToast('Custom field saved');
      setNewField({ label: '', field_type: 'text', default_val: '' });
      const f = await getCustomFields();
      setCustomFields(Array.isArray(f) ? f : []);
    } catch (err: any) {
      showToast(err.message || 'Failed to save field', 'err');
    }
  };

  const handleDeleteField = async (id: string) => {
    if (!window.confirm('Delete this custom field?')) return;
    try {
      await deleteCustomField(id);
      showToast('Field deleted');
      const f = await getCustomFields();
      setCustomFields(Array.isArray(f) ? f : []);
    } catch (err: any) {
      showToast(err.message || 'Failed to delete field', 'err');
    }
  };

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto space-y-5">
        {/* Toast */}
        {toast && (
          <div
            className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-lg shadow-xl text-sm font-semibold border ${
              toast.type === 'err'
                ? 'bg-red-950 text-red-200 border-red-800'
                : 'bg-emerald-950 text-emerald-200 border-emerald-800'
            }`}
          >
            {toast.msg}
          </div>
        )}

        {/* ── Top Bar ─────────────────────────────────────────────── */}
        <div className="flex justify-between items-center flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <span className="text-indigo-400">🏷️</span> Barcode Creator
            </h1>
            <div className="flex bg-gray-900 border border-gray-800 rounded-lg p-0.5">
              <button
                onClick={() => { setActiveTab('products'); setView('list'); }}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                  activeTab === 'products' ? 'bg-indigo-600 text-white shadow' : 'text-gray-400 hover:text-white'
                }`}
              >
                Products
              </button>
              <button
                onClick={() => { setActiveTab('fields'); }}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                  activeTab === 'fields' ? 'bg-indigo-600 text-white shadow' : 'text-gray-400 hover:text-white'
                }`}
              >
                Custom Fields
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {activeTab === 'products' && view === 'list' && (
              <button onClick={handleNewBarcode} className="sv-btn sv-btn-primary flex items-center gap-1.5">
                <span>+</span>
                <span>New Barcode</span>
              </button>
            )}

            {activeTab === 'products' && view === 'editor' && (
              <>
                <button
                  type="button"
                  onClick={() => setView('list')}
                  className="sv-btn sv-btn-ghost text-xs"
                >
                  ← Back to List
                </button>
                <button
                  type="button"
                  onClick={handlePrint}
                  disabled={!form.barcode}
                  className="sv-btn sv-btn-ghost text-xs text-indigo-300 border border-indigo-800 hover:bg-indigo-950/50 flex items-center gap-1"
                >
                  <span>🖨️</span>
                  <span>Print Label</span>
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="sv-btn sv-btn-primary text-xs flex items-center gap-1.5"
                >
                  <span>💾</span>
                  <span>{saving ? 'Saving…' : 'Save Product'}</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* ── PRODUCTS TAB: LIST VIEW ──────────────────────────────── */}
        {activeTab === 'products' && view === 'list' && (
          <div className="space-y-4">
            {/* Stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-3.5">
                <div className="text-xl font-bold text-white">{products.length}</div>
                <div className="text-xs text-gray-400">Total Products</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-3.5">
                <div className="text-xl font-bold text-emerald-400">{totalQty}</div>
                <div className="text-xs text-gray-400">Total Stock Qty</div>
              </div>
            </div>

            {/* Search row */}
            <div className="flex gap-2 max-w-md">
              <input
                type="text"
                placeholder="Search barcode, name, SKU, category…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="sv-input text-sm"
              />
              {search && (
                <button onClick={() => setSearch('')} className="sv-btn sv-btn-ghost text-xs">
                  Clear
                </button>
              )}
            </div>

            {/* Product Barcode Grid (mirroring Electron App) */}
            {loading ? (
              <div className="text-center py-12 text-gray-500">Loading products…</div>
            ) : filteredProducts.length === 0 ? (
              <div className="bg-gray-900 border border-dashed border-gray-800 rounded-2xl p-12 text-center space-y-3">
                <div className="text-4xl text-gray-600">▊▌▋▍</div>
                <div className="text-base font-bold text-white">
                  {search ? 'No matching products' : 'No products yet'}
                </div>
                <p className="text-xs text-gray-400 max-w-xs mx-auto">
                  {search ? 'Try another search term' : 'Click "New Barcode" to generate your first 12-digit barcode.'}
                </p>
                <button onClick={handleNewBarcode} className="sv-btn sv-btn-primary text-xs">
                  + New Barcode
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {filteredProducts.map((p) => (
                  <div
                    key={p._id || p.barcode}
                    onClick={() => handleSelectProduct(p)}
                    className="bg-gray-900 border border-gray-800 hover:border-indigo-500/60 rounded-xl p-3 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-lg flex flex-col justify-between group"
                  >
                    {/* Visual Barcode Display */}
                    <div className="bg-white p-2 rounded-lg flex items-center justify-center min-h-[58px]">
                      <BarcodeVisual
                        value={p.barcode}
                        width={1.2}
                        height={34}
                        fontSize={10}
                        displayValue={true}
                        className="p-0 shadow-none"
                      />
                    </div>

                    <div className="mt-2.5 space-y-1">
                      <div className="font-semibold text-xs text-white truncate group-hover:text-indigo-300 transition-colors">
                        {p.name || 'Unnamed Product'}
                      </div>
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="font-mono font-bold text-emerald-400">Rs. {fmtPrice(p.price)}</span>
                        <span
                          className={`font-semibold px-1.5 py-0.2 rounded text-[10px] ${
                            (p.quantity ?? 0) <= 0
                              ? 'bg-red-950 text-red-300'
                              : 'bg-gray-800 text-gray-300'
                          }`}
                        >
                          Qty: {p.quantity ?? 0}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── PRODUCTS TAB: EDITOR & PREVIEW VIEW ──────────────────── */}
        {activeTab === 'products' && view === 'editor' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Column: Form */}
            <div className="lg:col-span-7 bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-4">
              <h2 className="text-base font-bold text-white border-b border-gray-800 pb-3">
                {editingProduct ? 'Edit Product Barcode' : 'Create New Product Barcode'}
              </h2>

              <form onSubmit={handleSave} className="space-y-4">
                {/* Barcode Mode & Input */}
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
                      type="text"
                      className="sv-input font-mono flex-1 text-sm tracking-wider"
                      placeholder="e.g. 200000000001"
                      value={form.barcode}
                      readOnly={barcodeMode === 'auto' && !editingProduct}
                      onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                    />
                    {barcodeMode === 'auto' && (
                      <button
                        type="button"
                        onClick={handleRegenerateBarcode}
                        disabled={generatingBarcode}
                        title="Auto-generate a new unique 12-digit barcode"
                        className="sv-btn sv-btn-ghost text-xs px-3 whitespace-nowrap"
                      >
                        {generatingBarcode ? '…' : '↻ Auto Assign'}
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1">
                    {barcodeMode === 'auto'
                      ? '⚡ Unique 12-digit barcode number (> 10 digits) assigned.'
                      : '✏️ Enter manufacturer barcode. Must be longer than 10 digits for standard POS scanning.'}
                  </p>
                </div>

                {/* Product Name */}
                <div>
                  <label className="sv-label">Product Name *</label>
                  <input
                    required
                    type="text"
                    className="sv-input text-sm"
                    placeholder="e.g. iPhone 15 Pro Max 256GB"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>

                {/* Category / Modal & SKU */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="sv-label">Product Type / Category</label>
                    <select
                      className="sv-input text-sm"
                      value={form.category}
                      onChange={(e) => setForm({ ...form, category: e.target.value })}
                    >
                      {PRODUCT_MODALS.map((m) => (
                        <option key={m} value={m}>
                          {m || '— Select Category —'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="sv-label">SKU / Model Number</label>
                    <input
                      type="text"
                      className="sv-input text-sm"
                      placeholder="e.g. IP15PM-256"
                      value={form.sku}
                      onChange={(e) => setForm({ ...form, sku: e.target.value })}
                    />
                  </div>
                </div>

                {/* Price and Quantity */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="sv-label">Price (Rs.) *</label>
                    <input
                      required
                      type="number"
                      step="0.01"
                      min="0"
                      className="sv-input font-mono text-sm"
                      placeholder="0.00"
                      value={form.price}
                      onChange={(e) => setForm({ ...form, price: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="sv-label">Stock Quantity *</label>
                    <input
                      required
                      type="number"
                      min="0"
                      className="sv-input font-mono text-sm"
                      value={form.quantity}
                      onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                    />
                  </div>
                </div>

                {/* Scan Mode */}
                <div>
                  <label className="sv-label">Scan Mode</label>
                  <select
                    className="sv-input text-sm"
                    value={form.scan_mode}
                    onChange={(e) => setForm({ ...form, scan_mode: e.target.value })}
                  >
                    <option value="normal">Normal (POS Checkout &amp; Stock)</option>
                    <option value="inventory_only">Inventory Only (Not for Direct Sale)</option>
                  </select>
                </div>

                {/* Custom Fields */}
                {customFields.length > 0 && (
                  <div className="space-y-3 pt-3 border-t border-gray-800">
                    <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider">
                      Custom Fields
                    </div>
                    {customFields.map((f) => (
                      <div key={f._id || f.label}>
                        <label className="sv-label">{f.label}</label>
                        <input
                          type={f.field_type === 'number' ? 'number' : 'text'}
                          className="sv-input text-sm"
                          value={form.custom_fields?.[f.label] ?? f.default_val ?? ''}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              custom_fields: { ...form.custom_fields, [f.label]: e.target.value },
                            })
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex justify-between items-center pt-4 border-t border-gray-800">
                  {editingProduct ? (
                    <button
                      type="button"
                      onClick={handleDelete}
                      className="sv-btn sv-btn-danger text-xs"
                    >
                      🗑 Delete Product
                    </button>
                  ) : <div />}

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setView('list')}
                      className="sv-btn sv-btn-ghost text-xs"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="sv-btn sv-btn-primary text-xs"
                    >
                      {saving ? 'Saving…' : '💾 Save Product'}
                    </button>
                  </div>
                </div>
              </form>
            </div>

            {/* Right Column: Live Barcode Preview & Standalone Print (like Electron App) */}
            <div className="lg:col-span-5 space-y-4">
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-4">
                <h3 className="text-base font-bold text-white border-b border-gray-800 pb-3">
                  Barcode Live Preview
                </h3>

                {/* Preview Card matching Electron .bc-preview-card */}
                <div className="bg-white rounded-2xl p-6 text-center text-black shadow-xl space-y-3">
                  <div className="text-xs font-bold text-gray-500 uppercase tracking-widest">
                    Oshini Phone Store
                  </div>
                  {form.name && (
                    <div className="text-sm font-extrabold text-black uppercase tracking-tight truncate">
                      {form.name}
                    </div>
                  )}
                  {form.sku && (
                    <div className="text-[11px] font-mono text-gray-600">
                      SKU: {form.sku}
                    </div>
                  )}

                  {/* High Quality Code128 Visual SVG */}
                  <div className="py-2">
                    <BarcodeVisual
                      value={form.barcode || '200000000000'}
                      width={2.0}
                      height={58}
                      fontSize={13}
                      displayValue={true}
                      className="p-1 shadow-none"
                    />
                  </div>

                  <div className="text-base font-extrabold font-mono text-black">
                    Rs. {fmtPrice(form.price)}
                  </div>
                </div>

                {/* Standalone Print Label Controls */}
                <div className="bg-gray-950 p-4 rounded-xl border border-gray-800 space-y-3">
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Standalone Label Print
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="sv-label">Label Size</label>
                      <select
                        value={labelSize}
                        onChange={(e) => setLabelSize(e.target.value as any)}
                        className="sv-input text-xs"
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
                        value={printQty}
                        onChange={(e) => setPrintQty(Math.max(1, parseInt(e.target.value) || 1))}
                        className="sv-input font-mono text-center text-xs font-bold"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handlePrint}
                    disabled={!form.barcode}
                    className="sv-btn sv-btn-primary w-full text-xs font-bold py-2.5 flex items-center justify-center gap-2"
                  >
                    <span>🖨️</span>
                    <span>
                      Print {printQty} Label{printQty > 1 ? 's' : ''} (With Name &amp; Price)
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── CUSTOM FIELDS TAB ────────────────────────────────────── */}
        {activeTab === 'fields' && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-6">
            <div>
              <h2 className="text-base font-bold text-white">Custom Product Fields</h2>
              <p className="text-xs text-gray-400">
                Add extra fields that appear on every product form (e.g. "Warranty Period", "Supplier", "IMEI / Serial").
              </p>
            </div>

            {/* List of existing custom fields */}
            {customFields.length > 0 && (
              <div className="space-y-2">
                {customFields.map((f) => (
                  <div
                    key={f._id || f.label}
                    className="flex justify-between items-center bg-gray-950 p-3 rounded-xl border border-gray-800"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-white text-sm">{f.label}</span>
                      <span className="sv-badge sv-badge-blue text-[11px]">{f.field_type}</span>
                      {f.default_val && (
                        <span className="text-xs text-gray-400 font-mono">
                          Default: {f.default_val}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteField(f._id)}
                      className="sv-btn sv-btn-ghost text-xs text-red-400 hover:text-red-300"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add new field form */}
            <div className="bg-gray-950 p-4 rounded-xl border border-gray-800 space-y-3">
              <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider">
                Add New Field
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="sv-label">Field Label</label>
                  <input
                    type="text"
                    placeholder="e.g. Warranty Period"
                    value={newField.label}
                    onChange={(e) => setNewField({ ...newField, label: e.target.value })}
                    className="sv-input text-xs"
                  />
                </div>
                <div>
                  <label className="sv-label">Field Type</label>
                  <select
                    value={newField.field_type}
                    onChange={(e) => setNewField({ ...newField, field_type: e.target.value })}
                    className="sv-input text-xs"
                  >
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="date">Date</option>
                  </select>
                </div>
                <div>
                  <label className="sv-label">Default Value (Optional)</label>
                  <input
                    type="text"
                    placeholder="(optional)"
                    value={newField.default_val}
                    onChange={(e) => setNewField({ ...newField, default_val: e.target.value })}
                    className="sv-input text-xs"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={handleSaveField}
                className="sv-btn sv-btn-primary text-xs"
              >
                + Add Field
              </button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
