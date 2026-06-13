import { useState, useCallback, useEffect } from 'react';
import { formatCurrency } from './utils/format';

let upInvoiceSeq = 0;
const generateUPInvoiceNumber = () => {
    const now = new Date();
    const yy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const suffix = String(upInvoiceSeq++ % 100000).padStart(5, '0');
    return `UP-${yy}-${mm}${dd}-${suffix}`;
};

const WARRANTY_OPTIONS = [
    'No warranty', '7 days', '1 month', '3 months',
    '6 months', '1 year', '2 years', '3 years', '5 years',
];

const emptyItem = () => ({
    id: Date.now() + Math.random(),
    name: '',
    model: '',
    price: '',
    qty: 1,
    warranty: 'No warranty',
});

const fmt = (n) => formatCurrency(n);

export default function UsedPurchaseModule() {
    const [view, setView] = useState('new'); // 'new' | 'history'
    const [items, setItems] = useState([emptyItem()]);

    // Seller / Shop details (mandatory)
    const [sellerName, setSellerName] = useState('');
    const [sellerPhone, setSellerPhone] = useState('');
    const [purchasedShop, setPurchasedShop] = useState('');
    const [cashier, setCashier] = useState('');
    const [notes, setNotes] = useState('');

    // Payment
    const [paidCash, setPaidCash] = useState('');

    const [invoices, setInvoices] = useState([]);
    const [statusMsg, setStatusMsg] = useState('');
    const [shopConfig, setShopConfig] = useState({});
    const [printers, setPrinters] = useState([]);
    const [selectedPrinter, setSelectedPrinter] = useState('');
    const isElectron = !!window.electronAPI;

    useEffect(() => {
        if (!isElectron) return;
        window.electronAPI.getShopConfig().then(cfg => {
            setShopConfig(cfg || {});
            if (cfg?.cashier) setCashier(cfg.cashier);
        });
        window.electronAPI.listPrinters().then(r => {
            if (r.success) {
                setPrinters(r.printers);
                if (r.printers.length === 1) setSelectedPrinter(r.printers[0].name);
            }
        });
    }, [isElectron]);

    const loadHistory = useCallback(() => {
        if (!isElectron) return;
        window.electronAPI.getInvoices(200).then(r => {
            if (r.success) {
                // Only show used_purchase invoices
                setInvoices((r.invoices || []).filter(inv => inv.transaction_type === 'used_purchase'));
            }
        });
    }, [isElectron]);

    useEffect(() => {
        if (view === 'history') loadHistory();
    }, [view, loadHistory]);

    // ── Item helpers ──────────────────────────────────────────────────────
    const updateItem = (id, field, value) => {
        setItems(prev => prev.map(it => it.id === id ? { ...it, [field]: value } : it));
    };

    const addItem = () => setItems(prev => [...prev, emptyItem()]);

    const removeItem = (id) => {
        setItems(prev => prev.length > 1 ? prev.filter(it => it.id !== id) : prev);
    };

    // ── Totals ────────────────────────────────────────────────────────────
    const subtotal = items.reduce((s, it) => s + (parseFloat(it.price) || 0) * (parseInt(it.qty) || 1), 0);
    const balance = subtotal - (parseFloat(paidCash) || 0);

    // ── Validation ────────────────────────────────────────────────────────
    const validate = () => {
        if (!sellerName.trim()) return 'Seller name is required.';
        if (!sellerPhone.trim()) return 'Seller phone is required.';
        if (!purchasedShop.trim()) return 'Purchased shop / origin is required.';
        for (const it of items) {
            if (!it.name.trim()) return 'All items must have a name.';
            if (!it.price || parseFloat(it.price) <= 0) return `Item "${it.name || '?'}" needs a valid price.`;
            if (it.warranty === '' || it.warranty === undefined) return `Select warranty for "${it.name}".`;
        }
        return null;
    };

    // ── Save & Print ──────────────────────────────────────────────────────
    const handleSave = async (printAfter = true) => {
        const err = validate();
        if (err) { setStatusMsg('❌ ' + err); return; }

        const invoiceNo = generateUPInvoiceNumber();
        const now = new Date().toISOString();

        const invoiceItems = items.map(it => ({
            barcode: null, // no product barcode — inline entry
            name: it.name + (it.model ? ` (${it.model})` : ''),
            price: parseFloat(it.price) || 0,
            quantity: parseInt(it.qty) || 1,
            discount: 0,
            warranty: it.warranty,
            net_price: parseFloat(it.price) || 0,
            total: (parseFloat(it.price) || 0) * (parseInt(it.qty) || 1),
        }));

        const invoice = {
            invoice_no: invoiceNo,
            customer_name: sellerName,
            customer_phone: sellerPhone,
            cashier,
            subtotal,
            discount: 0,
            total: subtotal,
            paid_cash: parseFloat(paidCash) || 0,
            balance: Math.abs(balance),
            status: 'paid',
            transaction_type: 'used_purchase',
            return_reason: `Purchased shop: ${purchasedShop}${notes ? ' | Notes: ' + notes : ''}`,
            items: invoiceItems,
            created_at: now,
        };

        if (isElectron) {
            setStatusMsg('💾 Saving…');
            const r = await window.electronAPI.saveInvoice(invoice);
            if (!r.success) { setStatusMsg('❌ ' + r.error); return; }
        }

        if (printAfter && isElectron) {
            setStatusMsg('🖨️ Printing…');
            const res = await window.electronAPI.printReceipt({
                invoice: { ...invoice, invoiceItems },
                shopConfig,
                printerName: selectedPrinter || undefined,
            });
            setStatusMsg(res.success ? '✅ Saved & Printed!' : '❌ ' + res.error);
        } else {
            setStatusMsg('✅ Saved!');
        }

        // Reset form
        setItems([emptyItem()]);
        setSellerName('');
        setSellerPhone('');
        setPurchasedShop('');
        setNotes('');
        setPaidCash('');

        setTimeout(() => setStatusMsg(''), 3000);
    };

    const handleReprint = async (invoiceNo) => {
        if (!isElectron) return;
        setStatusMsg('🖨️ Reprinting…');
        const r = await window.electronAPI.getInvoice(invoiceNo);
        if (!r.success) { setStatusMsg('❌ ' + r.error); return; }
        await window.electronAPI.printReceipt({ invoice: r.invoice, shopConfig, printerName: selectedPrinter || undefined });
        setStatusMsg('✅ Reprinted!');
        setTimeout(() => setStatusMsg(''), 2500);
    };

    // ── Render ────────────────────────────────────────────────────────────
    return (
        <div className="billing-root">
            {/* Header */}
            <div className="billing-nav">
                <button className={`billing-nav-btn ${view === 'new' ? 'active' : ''}`} onClick={() => setView('new')}>
                    📦 New Used Purchase
                </button>
                <button className={`billing-nav-btn ${view === 'history' ? 'active' : ''}`} onClick={() => setView('history')}>
                    📋 Purchase History
                </button>
                {statusMsg && <span className="bill-status">{statusMsg}</span>}
            </div>

            {/* ── NEW PURCHASE ─────────────────────────────────────────────── */}
            {view === 'new' && (
                <div className="up-layout">

                    {/* Seller / Shop Section */}
                    <section className="up-section">
                        <div className="billing-section-title">Seller & Shop Details <span className="req-star">*required</span></div>
                        <div className="up-grid-2">
                            <label className="up-label">
                                Seller Name <span className="req-star">*</span>
                                <input className="bill-input" placeholder="Full name of seller"
                                    value={sellerName} onChange={e => setSellerName(e.target.value)} />
                            </label>
                            <label className="up-label">
                                Seller Phone <span className="req-star">*</span>
                                <input className="bill-input" placeholder="Contact number"
                                    value={sellerPhone} onChange={e => setSellerPhone(e.target.value)} />
                            </label>
                            <label className="up-label">
                                Purchased From (Shop/Origin) <span className="req-star">*</span>
                                <input className="bill-input" placeholder="e.g. Pettah Market, Private seller, etc."
                                    value={purchasedShop} onChange={e => setPurchasedShop(e.target.value)} />
                            </label>
                            <label className="up-label">
                                Cashier
                                <input className="bill-input" placeholder="Cashier name"
                                    value={cashier} onChange={e => setCashier(e.target.value)} />
                            </label>
                        </div>
                        <label className="up-label" style={{ marginTop: 8 }}>
                            Notes (optional)
                            <input className="bill-input" placeholder="Any extra details…"
                                value={notes} onChange={e => setNotes(e.target.value)} />
                        </label>
                    </section>

                    {/* Items Section */}
                    <section className="up-section">
                        <div className="billing-section-title" style={{ marginBottom: 8 }}>Items Being Purchased</div>
                        <table className="cart-table up-items-table">
                            <thead>
                                <tr>
                                    <th>Item Name <span className="req-star">*</span></th>
                                    <th>Model / IMEI</th>
                                    <th>Price (Rs.) <span className="req-star">*</span></th>
                                    <th>Qty</th>
                                    <th>Warranty <span className="req-star">*</span></th>
                                    <th>Total</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.map(it => (
                                    <tr key={it.id}>
                                        <td>
                                            <input className="cart-num-input up-name-input" placeholder="e.g. iPhone 12"
                                                value={it.name} onChange={e => updateItem(it.id, 'name', e.target.value)} />
                                        </td>
                                        <td>
                                            <input className="cart-num-input up-name-input" placeholder="Model / IMEI"
                                                value={it.model} onChange={e => updateItem(it.id, 'model', e.target.value)} />
                                        </td>
                                        <td>
                                            <input type="number" className="cart-num-input" placeholder="0.00" min="0"
                                                value={it.price} onChange={e => updateItem(it.id, 'price', e.target.value)} />
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                                <button className="cart-qty-btn" onClick={() => updateItem(it.id, 'qty', Math.max(1, (parseInt(it.qty) || 1) - 1))}>-</button>
                                                <input type="number" className="cart-num-input" min="1" value={it.qty}
                                                    onChange={e => updateItem(it.id, 'qty', e.target.value)} />
                                                <button className="cart-qty-btn" onClick={() => updateItem(it.id, 'qty', (parseInt(it.qty) || 1) + 1)}>+</button>
                                            </div>
                                        </td>
                                        <td>
                                            <select className="bill-input" value={it.warranty}
                                                onChange={e => updateItem(it.id, 'warranty', e.target.value)}>
                                                {WARRANTY_OPTIONS.map(w => <option key={w} value={w}>{w}</option>)}
                                            </select>
                                        </td>
                                        <td>Rs. {fmt((parseFloat(it.price) || 0) * (parseInt(it.qty) || 1))}</td>
                                        <td>
                                            <button className="cart-remove-btn" onClick={() => removeItem(it.id)}>×</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <button className="bill-btn secondary" style={{ marginTop: 8 }} onClick={addItem}>
                            + Add Another Item
                        </button>
                    </section>

                    {/* Summary */}
                    <section className="up-section up-summary-section">
                        <div className="bill-summary">
                            <div className="bill-summary-row bold">
                                <span>Total Payable to Seller</span>
                                <span>Rs. {fmt(subtotal)}</span>
                            </div>
                            <div className="bill-summary-row">
                                <span>Cash Given</span>
                                <input type="number" className="bill-input" style={{ width: 120, textAlign: 'right' }}
                                    placeholder="0.00" value={paidCash}
                                    onChange={e => setPaidCash(e.target.value)} />
                            </div>
                            {paidCash !== '' && (
                                <div className={`bill-summary-row bold ${balance > 0 ? 'outstanding' : 'paid'}`}>
                                    <span>{balance > 0 ? 'Still Owed' : 'Change'}</span>
                                    <span>Rs. {fmt(Math.abs(balance))}</span>
                                </div>
                            )}
                        </div>

                        {printers.length > 1 && (
                            <select className="bill-input" value={selectedPrinter}
                                onChange={e => setSelectedPrinter(e.target.value)} style={{ marginTop: 8 }}>
                                <option value="">-- Select Printer --</option>
                                {printers.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                            </select>
                        )}

                        <div className="bill-actions" style={{ marginTop: 12 }}>
                            <button className="bill-btn secondary" onClick={() => handleSave(false)}>
                                💾 Save Only
                            </button>
                            <button className="bill-btn primary" onClick={() => handleSave(true)}>
                                🖨️ Save & Print Invoice
                            </button>
                        </div>
                    </section>
                </div>
            )}

            {/* ── HISTORY ────────────────────────────────────────────────── */}
            {view === 'history' && (
                <div className="billing-history">
                    <table className="history-table">
                        <thead>
                            <tr>
                                <th>Invoice No</th>
                                <th>Date</th>
                                <th>Seller</th>
                                <th>Shop/Origin</th>
                                <th>Total</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {invoices.map(inv => (
                                <tr key={inv.invoice_no}>
                                    <td className="mono">{inv.invoice_no}</td>
                                    <td>{new Date(inv.created_at).toLocaleDateString()}</td>
                                    <td>{inv.customer_name || '—'}</td>
                                    <td style={{ fontSize: '0.8em', opacity: 0.75 }}>
                                        {(inv.return_reason || '').replace('Purchased shop: ', '').split(' | Notes:')[0]}
                                    </td>
                                    <td>Rs. {fmt(inv.total)}</td>
                                    <td>
                                        <button className="hist-btn" onClick={() => handleReprint(inv.invoice_no)}>
                                            🖨️ Reprint
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {invoices.length === 0 && (
                                <tr><td colSpan={6} className="bill-empty">No used purchase invoices yet.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
