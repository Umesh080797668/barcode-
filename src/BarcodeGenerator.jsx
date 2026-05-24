/**
 * BarcodeGenerator.jsx
 * Full barcode creation, preview, print, and product database management tab.
 * Uses JsBarcode (loaded via CDN script tag injected once) for rendering.
 */
import { useState, useEffect, useRef, useCallback } from 'react';

// ── load JsBarcode from CDN once ────────────────────────────────────────────
let jsBarcodeReady = false;
function ensureJsBarcode() {
  if (jsBarcodeReady || typeof window === 'undefined') return Promise.resolve();
  if (window.JsBarcode) { jsBarcodeReady = true; return Promise.resolve(); }
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js';
    s.onload = () => { jsBarcodeReady = true; resolve(); };
    document.head.appendChild(s);
  });
}

// ── helpers ──────────────────────────────────────────────────────────────────
// core product fields shown on the create/edit form. Keep 'name', 'quantity' and 'price' as required.
const CORE_FIELDS = [
  { key: 'name',     label: 'Product Name', type: 'text' },
  { key: 'quantity', label: 'Quantity',     type: 'number' },
  { key: 'price',    label: 'Price',        type: 'number' },
];

function ipcAvailable() {
  return typeof window !== 'undefined' && window.electronAPI;
}

// Fallback in-memory store when running outside Electron
const memStore = { products: [], fields: [], counter: 1000 };

async function apiCall(method, ...args) {
  if (ipcAvailable()) return window.electronAPI[method](...args);
  // in-browser fallback (dev preview)
  if (method === 'generateBarcode') {
    const num = `SV${Date.now().toString().slice(-8)}${String(memStore.counter++).padStart(4,'0')}`;
    return { barcode: num };
  }
  if (method === 'getProducts')   return { success: true, products: memStore.products };
  if (method === 'saveProduct') {
    const p = args[0];
    // validate required fields
    if (!p.barcode) return { success: false, error: 'Barcode required' };
    if (!String(p.name || '').trim()) return { success: false, error: 'Product name required' };
    if (p.quantity === undefined || p.quantity === null) return { success: false, error: 'Quantity required' };
    if (p.price === undefined || p.price === null) return { success: false, error: 'Price required' };

    if (p.id) {
      const idx = memStore.products.findIndex(x => x.id === p.id);
      if (idx >= 0) memStore.products[idx] = { ...memStore.products[idx], ...p };
    } else {
      p.id = Date.now();
      p.created_at = new Date().toISOString();
      memStore.products.unshift(p);
    }
    return { success: true, id: p.id, barcode: p.barcode };
  }
  if (method === 'deleteProduct') {
    memStore.products = memStore.products.filter(x => x.id !== args[0]);
    return { success: true };
  }
  if (method === 'getBarcodeStats') {
    const total = memStore.products.length;
    const totalQty = memStore.products.reduce((a,p) => a + (Number(p.quantity) || 0), 0);
    return { success: true, total, cats: 0, totalQty };
  }
  if (method === 'getCustomFields') return { success: true, fields: memStore.fields };
  if (method === 'saveCustomField') {
    const f = args[0];
    if (f.id) { const i = memStore.fields.findIndex(x=>x.id===f.id); if(i>=0) memStore.fields[i]={...memStore.fields[i],...f}; }
    else { f.id = Date.now(); memStore.fields.push(f); }
    return { success: true };
  }
  if (method === 'deleteCustomField') {
    memStore.fields = memStore.fields.filter(x => x.id !== args[0]);
    return { success: true };
  }
  return { success: false, error: 'Not implemented' };
}

// ── render barcode to SVG element ────────────────────────────────────────────
function renderBarcode(svgEl, value, opts = {}) {
  if (!svgEl || !value || !window.JsBarcode) return;
  try {
    window.JsBarcode(svgEl, value, {
      format:      'CODE128',
      lineColor:   '#000',
      background:  '#fff',
      width:       2,
      height:      60,
      displayValue: true,
      fontSize:    13,
      margin:      8,
      ...opts,
    });
  } catch (_) { /* invalid chars */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// Main component
// ═══════════════════════════════════════════════════════════════════════════
export default function BarcodeGenerator() {
  const [view, setView]           = useState('list'); // 'list' | 'create' | 'preview' | 'fields'
  const [products, setProducts]   = useState([]);
  const [customFields, setCF]     = useState([]);
  const [search, setSearch]       = useState('');
  const [stats, setStats]         = useState({});
  const [saving, setSaving]       = useState(false);
  const [toast, setToast]         = useState(null);
  const [editProduct, setEdit]    = useState(null); // product being edited/previewed
  const [printQty, setPrintQty]   = useState(1);
  const [labelSize, setLabelSize] = useState('medium'); // small | medium | large

  // new field editor
  const [newField, setNewField] = useState({ label:'', field_type:'text', default_val:'' });
  const [editField, setEditField] = useState(null);

  const svgRef     = useRef(null);
  const printRef   = useRef(null);
  const searchTimer = useRef(null);

  const notifyProductsChanged = () => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('products:changed'));
  };

  // ── toast helper ────────────────────────────────────────────────────────
  const showToast = (msg, type = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2800);
  };

  // ── load data ───────────────────────────────────────────────────────────
  const loadAll = useCallback(async (q = search) => {
    await ensureJsBarcode();
    const [pr, cf, st] = await Promise.all([
      apiCall('getProducts', { search: q }),
      apiCall('getCustomFields'),
      apiCall('getBarcodeStats'),
    ]);
    if (pr.success) setProducts(pr.products);
    if (cf.success) setCF(cf.fields);
    if (st.success) setStats(st);
  }, [search]);

  useEffect(() => { loadAll(''); }, []);

  // ── search debounce ─────────────────────────────────────────────────────
  const handleSearch = (v) => {
    setSearch(v);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => loadAll(v), 300);
  };

  // ── generate new barcode ─────────────────────────────────────────────────
  const handleNew = async () => {
    const res = await apiCall('generateBarcode');
    const blank = {
      barcode:       res.barcode,
      name:          '',
      sku:           '',
      price:         '',
      quantity:      '',
      category:      '',
      notes:         '',
      extra_fields:  {},
    };
    setEdit(blank);
    setView('create');
    setPrintQty(1);
  };

  // ── open existing for preview/edit ───────────────────────────────────────
  const handleOpen = async (p) => {
    setEdit({ ...p });
    setView('preview');
    setPrintQty(1);
  };

  // ── save product ─────────────────────────────────────────────────────────
  const handleSave = async () => {
    // Validate required fields when creating/saving
    if (!editProduct?.barcode) { showToast('Barcode required', 'err'); return; }
    if (!String(editProduct?.name || '').trim()) { showToast('Product name required', 'err'); return; }
    if (!editProduct?.quantity && editProduct?.quantity !== 0) { showToast('Quantity required', 'err'); return; }
    if (!editProduct?.price && editProduct?.price !== 0) { showToast('Price required', 'err'); return; }
    setSaving(true);
    const res = await apiCall('saveProduct', editProduct);
    setSaving(false);
    if (res.success) {
      showToast('Product saved ✓');
      await loadAll();
      notifyProductsChanged();
      setView('preview');
    } else {
      showToast('Save failed: ' + res.error, 'err');
    }
  };

  // ── delete product ───────────────────────────────────────────────────────
  const handleDelete = async (id) => {
    if (!window.confirm('Delete this product?')) return;
    await apiCall('deleteProduct', id);
    showToast('Deleted');
    await loadAll();
    notifyProductsChanged();
    setView('list');
  };

  // ── print ────────────────────────────────────────────────────────────────
  const handlePrint = () => {
    const sizes = { small: '25mm 15mm', medium: '50mm 30mm', large: '80mm 50mm' };
    const labelW = sizes[labelSize] || sizes.medium;
    const printWin = window.open('', '_blank', 'width=600,height=400');
    const copies = [];
    for (let i = 0; i < printQty; i++) {
      copies.push(`
        <div class="label">
          ${printRef.current?.outerHTML || ''}
          ${editProduct?.name ? `<div class="pname">${editProduct.name}</div>` : ''}
          ${editProduct?.price ? `<div class="pprice">Rs. ${parseFloat(editProduct.price).toFixed(2)}</div>` : ''}
        </div>`);
    }
    printWin.document.write(`
      <html><head><title>Print Barcodes</title>
      <style>
        @page { margin: 4mm; size: auto; }
        body { margin: 0; font-family: Arial, sans-serif; }
        .label { display: inline-flex; flex-direction: column; align-items: center;
                 border: 1px solid #ddd; padding: 4px 6px; margin: 2px;
                 page-break-inside: avoid; width: ${labelW.split(' ')[0]}; }
        .label svg { max-width: 100%; height: auto; }
        .pname  { font-size: 9px; font-weight: bold; text-align: center; margin-top: 2px; }
        .pprice { font-size: 9px; color: #333; }
      </style></head><body>
      ${copies.join('')}
      <script>window.onload=()=>{window.print();window.close();}<\/script>
      </body></html>`);
    printWin.document.close();
  };

  // ── render barcode whenever editProduct.barcode changes ──────────────────
  useEffect(() => {
    if ((view === 'preview' || view === 'create') && svgRef.current && editProduct?.barcode) {
      ensureJsBarcode().then(() => renderBarcode(svgRef.current, editProduct.barcode));
    }
  }, [view, editProduct?.barcode]);

  // also render to print-hidden svg
  useEffect(() => {
    if ((view === 'preview' || view === 'create') && printRef.current && editProduct?.barcode) {
      ensureJsBarcode().then(() => renderBarcode(printRef.current, editProduct.barcode, { width: 2, height: 70 }));
    }
  }, [view, editProduct?.barcode]);

  // ── custom field CRUD ────────────────────────────────────────────────────
  const handleSaveField = async () => {
    const f = editField || newField;
    if (!f.label.trim()) { showToast('Field label required', 'err'); return; }
    const key = f.field_key || f.label.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const res = await apiCall('saveCustomField', { ...f, field_key: key });
    if (res.success) {
      showToast('Field saved ✓');
      setNewField({ label:'', field_type:'text', default_val:'' });
      setEditField(null);
      await loadAll();
    }
  };

  const handleDeleteField = async (id) => {
    if (!window.confirm('Delete this custom field?')) return;
    await apiCall('deleteCustomField', id);
    showToast('Field deleted');
    await loadAll();
  };

  // ── field value change helper ────────────────────────────────────────────
  const setFieldVal = (key, val, isExtra = false) => {
    setEdit(prev => {
      if (isExtra) return { ...prev, extra_fields: { ...prev.extra_fields, [key]: val } };
      return { ...prev, [key]: val };
    });
  };

  // ════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════
  return (
    <div className="bc-root">
      {/* toast */}
      {toast && <div className={`bc-toast ${toast.type === 'err' ? 'bc-toast-err' : ''}`}>{toast.msg}</div>}

      {/* hidden SVG used for print only */}
      <svg ref={printRef} style={{ display:'none' }} />

      {/* ── NAV BAR ─────────────────────────────────────────────────── */}
      <div className="bc-nav">
        <div className="bc-nav-left">
          <button className={`bc-navbtn ${view==='list'?'active':''}`}    onClick={()=>setView('list')}>
            <IcoBarcode /> Products
          </button>
          <button className={`bc-navbtn ${view==='fields'?'active':''}`}  onClick={()=>setView('fields')}>
            <IcoSliders /> Custom Fields
          </button>
        </div>
        <div className="bc-nav-right">
          {view==='list' && (
            <button className="bc-btn-primary" onClick={handleNew}>
              <IcoPlus /> New Barcode
            </button>
          )}
          {(view==='create'||view==='preview') && (
            <>
              <button className="bc-btn-ghost" onClick={()=>setView('list')}>← Back</button>
              <button className="bc-btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : '💾 Save'}
              </button>
              {view==='preview' && (
                <button className="bc-btn-accent" onClick={handlePrint}>🖨 Print</button>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── STATS ROW ───────────────────────────────────────────────── */}
      {view === 'list' && (
        <div className="bc-stats-row">
          <StatPill label="Total Products" value={stats.total ?? 0} />
          <StatPill label="Total Qty"      value={stats.totalQty ?? 0} />
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
          LIST VIEW
      ══════════════════════════════════════════════════════════════ */}
      {view === 'list' && (
        <div className="bc-list-wrap">
          <div className="bc-search-row">
            <IcoSearch />
            <input
              className="bc-search"
              placeholder="Search barcode..."
              value={search}
              onChange={e => handleSearch(e.target.value)}
            />
          </div>

          {products.length === 0 ? (
            <div className="bc-empty">
              <div className="bc-empty-icon">▊▌▋▍</div>
              <h3>No products yet</h3>
              <p>Click "New Barcode" to create your first product barcode.</p>
              <button className="bc-btn-primary" onClick={handleNew}><IcoPlus /> New Barcode</button>
            </div>
          ) : (
            <div className="bc-product-grid">
              {products.map(p => (
                <ProductCard key={p.id} product={p} onClick={() => handleOpen(p)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
          CREATE / PREVIEW VIEW
      ══════════════════════════════════════════════════════════════ */}
      {(view === 'create' || view === 'preview') && editProduct && (
        <div className="bc-editor">
          {/* Left: form */}
          <div className="bc-form-col">
            <h3 className="bc-section-h">{view === 'create' ? 'New Product' : 'Edit Product'}</h3>

            <div className="bc-field-group">
              <label className="bc-label">Barcode Number</label>
              <div style={{ display:'flex', gap:8 }}>
                <input
                  className="bc-input bc-input-mono"
                  value={editProduct.barcode}
                  readOnly
                />
                <button className="bc-btn-ghost" title="Regenerate" onClick={async()=>{
                  const r = await apiCall('generateBarcode');
                  setFieldVal('barcode', r.barcode);
                }}>↻</button>
              </div>
            </div>

            {CORE_FIELDS.map(f => (
              <div className="bc-field-group" key={f.key}>
                <label className="bc-label">{f.label}</label>
                <input
                  className="bc-input"
                  type={f.type}
                  value={editProduct[f.key] ?? ''}
                  onChange={e => setFieldVal(f.key, e.target.value)}
                />
              </div>
            ))}

            {/* custom fields */}
            {customFields.length > 0 && (
              <>
                <div className="bc-divider">Custom Fields</div>
                {customFields.map(f => (
                  <div className="bc-field-group" key={f.field_key}>
                    <label className="bc-label">{f.label}</label>
                    <input
                      className="bc-input"
                      type={f.field_type === 'number' ? 'number' : 'text'}
                      value={editProduct.extra_fields?.[f.field_key] ?? f.default_val ?? ''}
                      onChange={e => setFieldVal(f.field_key, e.target.value, true)}
                    />
                  </div>
                ))}
              </>
            )}

            {view === 'preview' && editProduct.id && (
              <button
                className="bc-btn-danger"
                style={{ marginTop:24 }}
                onClick={() => handleDelete(editProduct.id)}
              >🗑 Delete Product</button>
            )}
          </div>

          {/* Right: preview */}
          <div className="bc-preview-col">
            <h3 className="bc-section-h">Barcode Preview</h3>

            <div className="bc-preview-card">
              {editProduct.name && <div className="bc-preview-name">{editProduct.name}</div>}
              {editProduct.sku  && <div className="bc-preview-sku">SKU: {editProduct.sku}</div>}
              <svg ref={svgRef} className="bc-preview-svg" />
              {editProduct.price && (
                <div className="bc-preview-price">Rs. {parseFloat(editProduct.price||0).toFixed(2)}</div>
              )}
            </div>

            {/* print options */}
            <div className="bc-print-opts">
              <div className="bc-field-group">
                <label className="bc-label">Label Size</label>
                <select className="bc-input" value={labelSize} onChange={e=>setLabelSize(e.target.value)}>
                  <option value="small">Small (25×15 mm)</option>
                  <option value="medium">Medium (50×30 mm)</option>
                  <option value="large">Large (80×50 mm)</option>
                </select>
              </div>
              <div className="bc-field-group">
                <label className="bc-label">Copies</label>
                <input
                  className="bc-input"
                  type="number" min={1} max={100}
                  value={printQty}
                  onChange={e=>setPrintQty(Math.max(1,parseInt(e.target.value)||1))}
                />
              </div>
              <button
                className="bc-btn-accent bc-print-btn"
                onClick={handlePrint}
                disabled={!editProduct?.barcode}
              >🖨 Print {printQty} Label{printQty>1?'s':''}</button>
            </div>

            {editProduct.created_at && (
              <div className="bc-meta">
                Created: {new Date(editProduct.created_at).toLocaleString()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
          CUSTOM FIELDS VIEW
      ══════════════════════════════════════════════════════════════ */}
      {view === 'fields' && (
        <div className="bc-fields-wrap">
          <h3 className="bc-section-h">Custom Product Fields</h3>
          <p className="bc-section-sub">
            Add extra fields that appear on every product form — e.g. "Supplier", "Expiry Date", "Weight".
          </p>

          {/* existing fields */}
          {customFields.length > 0 && (
            <div className="bc-cf-list">
              {customFields.map(f => (
                <div key={f.id} className="bc-cf-row">
                  {editField?.id === f.id ? (
                    <>
                      <input className="bc-input" style={{flex:1}} value={editField.label}
                        onChange={e=>setEditField({...editField,label:e.target.value})} />
                      <select className="bc-input" style={{width:110}} value={editField.field_type}
                        onChange={e=>setEditField({...editField,field_type:e.target.value})}>
                        <option value="text">Text</option>
                        <option value="number">Number</option>
                        <option value="date">Date</option>
                      </select>
                      <input className="bc-input" style={{flex:1}} placeholder="Default value"
                        value={editField.default_val||''}
                        onChange={e=>setEditField({...editField,default_val:e.target.value})} />
                      <button className="bc-btn-primary" onClick={handleSaveField}>Save</button>
                      <button className="bc-btn-ghost"   onClick={()=>setEditField(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <span className="bc-cf-label">{f.label}</span>
                      <span className="bc-cf-type">{f.field_type}</span>
                      {f.default_val && <span className="bc-cf-default">default: {f.default_val}</span>}
                      <button className="bc-btn-ghost" onClick={()=>setEditField({...f})}>Edit</button>
                      <button className="bc-btn-ghost bc-btn-red" onClick={()=>handleDeleteField(f.id)}>×</button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* add new field */}
          <div className="bc-cf-add">
            <h4 className="bc-section-h" style={{fontSize:13,marginBottom:12}}>Add New Field</h4>
            <div className="bc-cf-add-row">
              <div className="bc-field-group" style={{flex:1}}>
                <label className="bc-label">Field Label</label>
                <input className="bc-input" placeholder="e.g. Supplier" value={newField.label}
                  onChange={e=>setNewField({...newField, label:e.target.value})} />
              </div>
              <div className="bc-field-group" style={{width:130}}>
                <label className="bc-label">Type</label>
                <select className="bc-input" value={newField.field_type}
                  onChange={e=>setNewField({...newField, field_type:e.target.value})}>
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                  <option value="date">Date</option>
                </select>
              </div>
              <div className="bc-field-group" style={{flex:1}}>
                <label className="bc-label">Default Value</label>
                <input className="bc-input" placeholder="(optional)" value={newField.default_val}
                  onChange={e=>setNewField({...newField, default_val:e.target.value})} />
              </div>
              <div className="bc-field-group" style={{alignSelf:'flex-end'}}>
                <button className="bc-btn-primary" onClick={()=>{setEditField(null); handleSaveField();}}>
                  <IcoPlus /> Add Field
                </button>
              </div>
            </div>
          </div>

          <div className="bc-cf-info">
            <strong>Note:</strong> Custom fields are stored with every product in the embedded database.
            Deleting a field won't remove existing data — existing products will just no longer show that column.
          </div>
        </div>
      )}
    </div>
  );
}

// ─── sub-components ──────────────────────────────────────────────────────────

function ProductCard({ product, onClick }) {
  const svgEl = useRef(null);
  useEffect(() => {
    if (svgEl.current && product.barcode) {
      ensureJsBarcode().then(() =>
        renderBarcode(svgEl.current, product.barcode, { height: 38, fontSize: 10, width: 1.5, margin: 4 })
      );
    }
  }, [product.barcode]);

  return (
    <div className="bc-pcard" onClick={onClick}>
      <svg ref={svgEl} className="bc-pcard-svg" />
      <div className="bc-pcard-body">
        <div className="bc-pcard-meta" style={{color: '#111827', fontWeight: 600}}>Qty: {product.quantity || 0}</div>
      </div>
    </div>
  );
}

function StatPill({ label, value }) {
  return (
    <div className="bc-stat-pill">
      <span className="bc-stat-val">{value}</span>
      <span className="bc-stat-label">{label}</span>
    </div>
  );
}

// ─── icons ───────────────────────────────────────────────────────────────────
const IcoBarcode  = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 5v14M7 5v14M13 5v14M17 5v14M21 5v14M10 5v3M10 10v4M10 16v3"/></svg>;
const IcoSliders  = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="9" cy="6" r="2" fill="currentColor"/><circle cx="15" cy="12" r="2" fill="currentColor"/><circle cx="9" cy="18" r="2" fill="currentColor"/></svg>;
const IcoPlus     = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
const IcoSearch   = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
