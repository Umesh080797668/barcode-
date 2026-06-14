import { useState, useEffect, useCallback, useRef } from 'react';
import { formatCurrency } from './utils/format';

const NOOP_API = !window.electronAPI;

// ── Helper ───────────────────────────────────────────────────────────────────
function OosTag() {
    return <span className="sr-oos-tag">OUT OF STOCK</span>;
}

function ProductCard({ product, label = 'Product' }) {
    if (!product) return null;
    const isOos = Number(product.quantity) === 0;
    return (
        <div className={`sr-product-card${isOos ? ' sr-product-card--oos' : ''}`}>
            <div className="sr-product-card-label">{label}</div>
            <div className="sr-product-card-main">
                <span className="sr-product-name">{product.name || product.barcode}</span>
                {product.modal && <span className="sr-product-modal">Model: {product.modal}</span>}
            </div>
            <div className="sr-product-card-meta">
                <span className="sr-product-bc">{product.barcode}</span>
                <span className={`sr-qty-badge${isOos ? ' sr-qty-badge--oos' : ''}`}>
                    Qty: {product.quantity}
                </span>
                {isOos && <OosTag />}
                {product.category && <span className="sr-product-cat">{product.category}</span>}
                {product.price != null && <span className="sr-product-price">Rs. {formatCurrency(product.price)}</span>}
            </div>
        </div>
    );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function SupplierReturnsModule() {
    // Form state
    const [returnedBarcode, setReturnedBarcode] = useState('');
    const [returnedProduct, setReturnedProduct] = useState(null);
    const [returnedQty, setReturnedQty] = useState(1);
    const [returnType, setReturnType] = useState('no_replacement'); // 'no_replacement' | 'replaced'
    const [replacementBarcode, setReplacementBarcode] = useState('');
    const [replacementProduct, setReplacementProduct] = useState(null);
    const [replacementQty, setReplacementQty] = useState(1);
    const [notes, setNotes] = useState('');

    // UI state
    const [searching, setSearching] = useState(false);
    const [searchingRep, setSearchingRep] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');
    const [history, setHistory] = useState([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);

    const msgTimer = useRef(null);

    const showMsg = useCallback((type, msg) => {
        clearTimeout(msgTimer.current);
        if (type === 'error') setError(msg);
        else setSuccessMsg(msg);
        msgTimer.current = setTimeout(() => {
            setError('');
            setSuccessMsg('');
        }, 4000);
    }, []);

    // ── History ────────────────────────────────────────────────────────────────
    const loadHistory = useCallback(async () => {
        if (NOOP_API) return;
        setLoadingHistory(true);
        try {
            const r = await window.electronAPI.getSupplierReturns();
            if (r?.success) setHistory(r.returns || []);
        } finally {
            setLoadingHistory(false);
        }
    }, []);

    useEffect(() => { void loadHistory(); }, [loadHistory]);

    // ── Product lookup ─────────────────────────────────────────────────────────
    const lookupProduct = useCallback(async (barcode, setProduct, setBusy) => {
        const bc = String(barcode).trim();
        if (!bc) { setProduct(null); return; }
        if (NOOP_API) {
            setProduct({ barcode: bc, name: 'Demo Product', quantity: 5, price: 100, modal: 'Model-X' });
            return;
        }
        setBusy(true);
        try {
            const r = await window.electronAPI.getProduct(bc);
            setProduct(r?.product || null);
        } finally {
            setBusy(false);
        }
    }, []);

    // Debounce returned-barcode lookup
    const retDebounce = useRef(null);
    useEffect(() => {
        clearTimeout(retDebounce.current);
        if (!returnedBarcode.trim()) { setReturnedProduct(null); return; }
        retDebounce.current = setTimeout(() => {
            void lookupProduct(returnedBarcode, setReturnedProduct, setSearching);
        }, 400);
        return () => clearTimeout(retDebounce.current);
    }, [returnedBarcode, lookupProduct]);

    // Debounce replacement-barcode lookup
    const repDebounce = useRef(null);
    useEffect(() => {
        if (returnType !== 'replaced') { setReplacementProduct(null); return; }
        clearTimeout(repDebounce.current);
        if (!replacementBarcode.trim()) { setReplacementProduct(null); return; }
        repDebounce.current = setTimeout(() => {
            void lookupProduct(replacementBarcode, setReplacementProduct, setSearchingRep);
        }, 400);
        return () => clearTimeout(repDebounce.current);
    }, [replacementBarcode, returnType, lookupProduct]);

    // ── Submit ──────────────────────────────────────────────────────────────────
    const handleSubmit = useCallback(async () => {
        setConfirmOpen(false);
        setError('');
        setSuccessMsg('');

        if (!returnedBarcode.trim()) { showMsg('error', 'Please enter the returned product barcode.'); return; }
        if (returnType === 'replaced' && !replacementBarcode.trim()) {
            showMsg('error', 'Please enter the replacement product barcode.'); return;
        }

        setSubmitting(true);
        try {
            const payload = {
                returned_barcode: returnedBarcode.trim(),
                returned_name: returnedProduct?.name || '',
                returned_qty: returnedQty,
                return_type: returnType,
                replacement_barcode: returnType === 'replaced' ? replacementBarcode.trim() : null,
                replacement_name: replacementProduct?.name || null,
                replacement_modal: replacementProduct?.modal || returnedProduct?.modal || null,
                replacement_qty: returnType === 'replaced' ? replacementQty : 0,
                notes: notes.trim() || null,
            };

            let result;
            if (NOOP_API) {
                result = { success: true, id: Date.now() };
            } else {
                result = await window.electronAPI.saveSupplierReturn(payload);
            }

            if (result?.success) {
                showMsg('success', 'Return recorded and inventory updated.');
                // Reset form
                setReturnedBarcode('');
                setReturnedProduct(null);
                setReturnedQty(1);
                setReturnType('no_replacement');
                setReplacementBarcode('');
                setReplacementProduct(null);
                setReplacementQty(1);
                setNotes('');
                // Reload history & trigger inventory refresh
                await loadHistory();
                window.dispatchEvent(new Event('products:changed'));
            } else {
                showMsg('error', result?.error || 'Failed to save return.');
            }
        } finally {
            setSubmitting(false);
        }
    }, [
        returnedBarcode, returnedProduct, returnedQty, returnType,
        replacementBarcode, replacementProduct, replacementQty, notes,
        loadHistory, showMsg,
    ]);

    // ── Delete history item ────────────────────────────────────────────────────
    const handleDelete = useCallback(async (id) => {
        if (!window.confirm('Delete this return record? Stock quantities will NOT be reversed.')) return;
        if (NOOP_API) { setHistory(prev => prev.filter(r => r.id !== id)); return; }
        const r = await window.electronAPI.deleteSupplierReturn(id);
        if (r?.success) setHistory(prev => prev.filter(row => row.id !== id));
        else showMsg('error', r?.error || 'Delete failed');
    }, [showMsg]);

    // ── Render ─────────────────────────────────────────────────────────────────
    return (
        <div className="sr-panel">

            {/* ── Header ── */}
            <div className="sr-header">
                <div className="sr-header-left">
                    <span className="sr-header-icon">↩️</span>
                    <div>
                        <h2 className="sr-title">Supplier Returns</h2>
                        <p className="sr-subtitle">Return products to supplier — adjusts stock automatically</p>
                    </div>
                </div>
                <div className="sr-badge-large">
                    {history.length} record{history.length !== 1 ? 's' : ''}
                </div>
            </div>

            {/* ── Status messages ── */}
            {error && <div className="sr-alert sr-alert--error">⚠ {error}</div>}
            {successMsg && <div className="sr-alert sr-alert--success">✔ {successMsg}</div>}

            {/* ── Return Form ── */}
            <div className="sr-form-card">
                <h3 className="sr-form-title">New Supplier Return</h3>

                {/* Returned product */}
                <div className="sr-field-group">
                    <label className="sr-label">Returned Product Barcode</label>
                    <div className="sr-input-row">
                        <input
                            className="sr-input"
                            placeholder="Scan or type barcode…"
                            value={returnedBarcode}
                            onChange={e => setReturnedBarcode(e.target.value)}
                        />
                        {searching && <span className="sr-spinner" />}
                    </div>
                    {returnedBarcode && !returnedProduct && !searching && (
                        <div className="sr-field-warn">⚠ Product not found in inventory — return will still be logged.</div>
                    )}
                    <ProductCard product={returnedProduct} label="Returned Item" />
                </div>

                {/* Qty returned */}
                <div className="sr-field-group sr-field-group--inline">
                    <label className="sr-label">Quantity Returned</label>
                    <input
                        className="sr-input sr-input--num"
                        type="number"
                        min={1}
                        value={returnedQty}
                        onChange={e => setReturnedQty(Math.max(1, Number(e.target.value) || 1))}
                    />
                </div>

                {/* Return type */}
                <div className="sr-field-group">
                    <label className="sr-label">Return Type</label>
                    <div className="sr-type-toggle">
                        <button
                            className={`sr-type-btn${returnType === 'no_replacement' ? ' sr-type-btn--active' : ''}`}
                            onClick={() => setReturnType('no_replacement')}
                            type="button"
                        >
                            <span className="sr-type-icon">📦❌</span>
                            <span className="sr-type-title">No Replacement</span>
                            <span className="sr-type-sub">Stock decreases only</span>
                        </button>
                        <button
                            className={`sr-type-btn${returnType === 'replaced' ? ' sr-type-btn--active' : ''}`}
                            onClick={() => setReturnType('replaced')}
                            type="button"
                        >
                            <span className="sr-type-icon">🔄</span>
                            <span className="sr-type-title">Replaced (Same Model)</span>
                            <span className="sr-type-sub">Stock down + replacement up</span>
                        </button>
                    </div>
                </div>

                {/* Replacement section */}
                {returnType === 'replaced' && (
                    <div className="sr-replacement-block">
                        <div className="sr-replacement-header">Replacement Product</div>
                        <div className="sr-field-group">
                            <label className="sr-label">Replacement Barcode</label>
                            <div className="sr-input-row">
                                <input
                                    className="sr-input"
                                    placeholder="Scan or type replacement barcode…"
                                    value={replacementBarcode}
                                    onChange={e => setReplacementBarcode(e.target.value)}
                                />
                                {searchingRep && <span className="sr-spinner" />}
                            </div>
                            {replacementBarcode && !replacementProduct && !searchingRep && (
                                <div className="sr-field-hint">Not found — a new inventory row will be created at qty {replacementQty}.</div>
                            )}
                            <ProductCard product={replacementProduct} label="Replacement Item" />
                        </div>
                        <div className="sr-field-group sr-field-group--inline">
                            <label className="sr-label">Replacement Qty Received</label>
                            <input
                                className="sr-input sr-input--num"
                                type="number"
                                min={1}
                                value={replacementQty}
                                onChange={e => setReplacementQty(Math.max(1, Number(e.target.value) || 1))}
                            />
                        </div>
                    </div>
                )}

                {/* Notes */}
                <div className="sr-field-group">
                    <label className="sr-label">Notes (optional)</label>
                    <input
                        className="sr-input"
                        placeholder="Reason, supplier name, invoice ref…"
                        value={notes}
                        onChange={e => setNotes(e.target.value)}
                    />
                </div>

                {/* Confirm dialog */}
                {confirmOpen && (
                    <div className="sr-confirm-box">
                        <div className="sr-confirm-msg">
                            <strong>Confirm:</strong>{' '}
                            {returnType === 'no_replacement'
                                ? `Decrease "${returnedBarcode}" by ${returnedQty}.`
                                : `Decrease "${returnedBarcode}" by ${returnedQty} and increase "${replacementBarcode}" by ${replacementQty}.`}
                        </div>
                        <div className="sr-confirm-actions">
                            <button className="btn-accent" onClick={handleSubmit} disabled={submitting}>
                                {submitting ? 'Processing…' : 'Confirm & Apply'}
                            </button>
                            <button className="btn-ghost" onClick={() => setConfirmOpen(false)} disabled={submitting}>
                                Cancel
                            </button>
                        </div>
                    </div>
                )}

                {!confirmOpen && (
                    <button
                        className="btn-accent sr-submit-btn"
                        onClick={() => setConfirmOpen(true)}
                        disabled={submitting || !returnedBarcode.trim()}
                    >
                        ↩ Record Return
                    </button>
                )}
            </div>

            {/* ── History Table ── */}
            <div className="sr-history-section">
                <div className="sr-history-header">
                    <span className="sr-history-title">Return History</span>
                    <button className="btn-ghost btn-sm" onClick={loadHistory} disabled={loadingHistory}>
                        {loadingHistory ? 'Loading…' : '↺ Refresh'}
                    </button>
                </div>

                {history.length === 0 ? (
                    <div className="sr-empty">
                        <div className="sr-empty-icon">📋</div>
                        <p>No supplier returns recorded yet.</p>
                    </div>
                ) : (
                    <div className="sr-table-wrap">
                        <table className="sr-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Type</th>
                                    <th>Returned</th>
                                    <th>Qty ↓</th>
                                    <th>Replacement</th>
                                    <th>Qty ↑</th>
                                    <th>Notes</th>
                                    <th>Date</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {history.map((row, i) => {
                                    const isOos = row.return_type === 'no_replacement';
                                    return (
                                        <tr key={row.id} className="sr-table-row">
                                            <td className="td-num">{i + 1}</td>
                                            <td>
                                                <span className={`sr-type-badge ${row.return_type === 'replaced' ? 'sr-type-badge--rep' : 'sr-type-badge--no'}`}>
                                                    {row.return_type === 'replaced' ? '🔄 Replaced' : '📦 No Repl.'}
                                                </span>
                                            </td>
                                            <td>
                                                <div className="sr-table-bc">{row.returned_barcode}</div>
                                                {row.returned_name && <div className="sr-table-name">{row.returned_name}</div>}
                                            </td>
                                            <td>
                                                <span className="sr-qty-badge sr-qty-badge--down">-{row.returned_qty}</span>
                                                {isOos && <OosTag />}
                                            </td>
                                            <td>
                                                {row.replacement_barcode
                                                    ? (<>
                                                        <div className="sr-table-bc">{row.replacement_barcode}</div>
                                                        {row.replacement_name && <div className="sr-table-name">{row.replacement_name}</div>}
                                                    </>)
                                                    : <span className="sr-muted">—</span>}
                                            </td>
                                            <td>
                                                {row.return_type === 'replaced'
                                                    ? <span className="sr-qty-badge sr-qty-badge--up">+{row.replacement_qty}</span>
                                                    : <span className="sr-muted">—</span>}
                                            </td>
                                            <td className="sr-muted">{row.notes || '—'}</td>
                                            <td style={{ fontSize: 11, color: 'var(--muted)' }}>
                                                {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}
                                            </td>
                                            <td>
                                                <button
                                                    className="sr-del-btn"
                                                    title="Delete record (stock NOT reversed)"
                                                    onClick={() => handleDelete(row.id)}
                                                >
                                                    ✕
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
        </div>
    );
}
