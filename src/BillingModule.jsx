import { useState, useEffect, useCallback } from 'react';

export default function BillingModule({ filePath, sheetName, columnConfig }) {
  const [view, setView] = useState('new'); // 'new' | 'history' | 'settings'
  const [products, setProducts] = useState([]);
  const [cartItems, setCartItems] = useState([]);
  const [searchProd, setSearchProd] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [cashier, setCashier] = useState('');
  const [paidCash, setPaidCash] = useState('');
  const [invoices, setInvoices] = useState([]);
  // printable preview is opened in a new window; no modal state required
  const [shopConfig, setShopConfig] = useState({});
  const [printers, setPrinters] = useState([]);
  const [selectedPrinter, setSelectedPrinter] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [isElectron] = useState(!!window.electronAPI);

  // Load products, shop config, printers on mount
  useEffect(() => {
    if (!isElectron) return;
    window.electronAPI.getProducts().then(r => {
      if (r.success) setProducts(r.products);
    });
    window.electronAPI.getShopConfig().then(cfg => {
      setShopConfig(cfg || {});
      if (cfg?.cashier) setCashier(cfg.cashier);
    });
    window.electronAPI.listPrinters().then(r => {
      if (r.success) {
        setPrinters(r.printers);
        // Auto-select first printer if only one
        if (r.printers.length === 1) setSelectedPrinter(r.printers[0].name);
      }
    });
  }, [isElectron]);

  const loadInvoices = useCallback(() => {
    if (!isElectron) return;
    window.electronAPI.getInvoices(100).then(r => {
      if (r.success) setInvoices(r.invoices);
    });
  }, [isElectron]);

  useEffect(() => {
    if (view === 'history') loadInvoices();
  }, [view, loadInvoices]);

  // ── Cart logic ──────────────────────────────────────────────────────────────
  const addToCart = (product) => {
    setCartItems(prev => {
      const existing = prev.find(i => i.barcode === product.barcode);
      if (existing) {
        return prev.map(i => i.barcode === product.barcode
          ? { ...i, quantity: i.quantity + 1, total: (i.quantity + 1) * i.net_price }
          : i
        );
      }
      return [...prev, {
        barcode: product.barcode,
        name: product.name,
        price: product.price,
        discount: 0,
        net_price: product.price,
        quantity: 1,
        total: product.price
      }];
    });
  };

  const updateCartItem = (barcode, field, value) => {
    setCartItems(prev => prev.map(item => {
      if (item.barcode !== barcode) return item;
      const updated = { ...item, [field]: parseFloat(value) || 0 };
      const net = updated.price - (updated.discount || 0);
      updated.net_price = net;
      updated.total = net * updated.quantity;
      return updated;
    }));
  };

  const removeCartItem = (barcode) => {
    setCartItems(prev => prev.filter(i => i.barcode !== barcode));
  };

  // ── Totals ──────────────────────────────────────────────────────────────────
  const subtotal = cartItems.reduce((s, i) => s + i.price * i.quantity, 0);
  const totalDiscount = cartItems.reduce((s, i) => s + (i.discount || 0) * i.quantity, 0);
  const total = cartItems.reduce((s, i) => s + i.total, 0);
  const balance = total - (parseFloat(paidCash) || 0);

  const fmt = (n) => parseFloat(n || 0).toFixed(2);

  // ── Save & Print ────────────────────────────────────────────────────────────
  const handleSaveAndPrint = async (printAfter = true) => {
    // Build invoice and open preview for confirmation before saving
    if (cartItems.length === 0) { setStatusMsg('❌ Cart is empty'); return; }
    const invoice = {
      customer_name: customerName,
      customer_phone: customerPhone,
      cashier,
      subtotal,
      discount: totalDiscount,
      total,
      paid_cash: parseFloat(paidCash) || 0,
      balance: Math.max(0, balance),
      status: balance <= 0 ? 'paid' : 'unpaid',
      items: cartItems
    };

    // Open preview window for confirmation; when printing requested show thermal layout
    openInvoicePreview(invoice, { forSave: true, printAfter, thermal: !!printAfter });
  };

  // Open a printable preview in a new window. Options: { forSave: bool, printAfter: bool }
  const openInvoicePreview = (invoice, options = {}) => {
    const thermal = !!options.thermal;
    const win = window.open('', '_blank', thermal ? 'width=360,height=900' : 'width=800,height=900');
    const itemsHtml = invoice.items.map(it => `
      <tr>
        <td>${it.name}</td>
        <td style="text-align:center">${it.quantity}</td>
        <td style="text-align:right">Rs. ${parseFloat(it.price||0).toFixed(2)}</td>
        <td style="text-align:right">Rs. ${parseFloat((it.net_price||it.price||0) * it.quantity).toFixed(2)}</td>
      </tr>
    `).join('');

    const saveButtons = options.forSave ? `<button id="saveBtn">Save</button>` : '';

    // thermal layout styles vs regular
    const styles = thermal ? `
        body{font-family: Arial, sans-serif; padding:8px; width:320px}
        .inv{max-width:320px}
        h1{font-size:16px;margin:4px 0}
        table{width:100%;border-collapse:collapse;margin-top:8px}
        th,td{padding:6px 2px;font-size:13px}
        thead th{border-bottom:1px solid #000}
        .totals{margin-top:8px;font-size:13px}
        .actions{margin-top:8px}
      ` : `
        body { font-family: Arial, sans-serif; padding: 20px; }
        .inv { max-width: 720px; margin: 0 auto; }
        h1 { margin-bottom: 4px; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; }
        th, td { border-bottom: 1px solid #ddd; padding: 8px; }
        th { text-align: left; }
        .right { text-align: right; }
        .totals { margin-top: 12px; width: 100%; }
        .totals div { display:flex; justify-content:space-between; padding:4px 0; }
        .actions { margin-top: 16px; }
      `;

    const html = `
      <html><head><title>Invoice ${invoice.invoice_no}</title>
      <style>${styles}</style>
      </head><body>
        <div class="inv">
          <div style="text-align:center; margin-bottom:6px;">
            <img src="${(shopConfig && shopConfig.logo) || '/logo.png'}" alt="logo" style="max-width:${thermal ? 240 : 200}px; max-height:80px; display:block; margin:0 auto;" onerror="this.style.display='none'" />
          </div>
          <div style="text-align:center;">
            <div style="font-weight:700; font-size:${thermal ? '16px' : '20px'}">${(shopConfig && shopConfig.name) || ''}</div>
            <div style="font-size:12px">${(shopConfig && shopConfig.tagline) || ''}</div>
            <div style="font-size:12px">${(shopConfig && shopConfig.address) || ''}</div>
            <div style="font-size:12px">${(shopConfig && shopConfig.phone) || ''}</div>
          </div>
          <hr />
          <div style="text-align:left; font-size:13px; margin-top:6px;">
            <div><strong>Receipt - Original</strong></div>
            <div>Invoice: ${invoice.invoice_no || '—'}</div>
            <div>Date: ${new Date(invoice.created_at || Date.now()).toLocaleString()}</div>
            <div>Cashier: ${invoice.cashier || '—'}</div>
          </div>
          <table>
            <thead><tr><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Price</th><th style="text-align:right">Total</th></tr></thead>
            <tbody>${itemsHtml}</tbody>
          </table>
          <div class="totals">
            <div><span>Sub Total</span><span>Rs. ${parseFloat(invoice.subtotal||0).toFixed(2)}</span></div>
            <div><span>Total</span><span>Rs. ${parseFloat(invoice.total||0).toFixed(2)}</span></div>
            <div><span>Paid Cash</span><span>Rs. ${parseFloat(invoice.paid_cash||0).toFixed(2)}</span></div>
            <div><span>Balance</span><span>Rs. ${parseFloat(invoice.balance||0).toFixed(2)}</span></div>
          </div>

          <div style="margin-top:8px; text-align:center;">
            <div style="font-family:monospace; font-size:14px;">| ${invoice.invoice_no || ''} |</div>
          </div>

          <div class="actions">
            <button id="printBtn">Print</button>
            ${saveButtons}
            <button id="closeBtn">Close</button>
          </div>
          <div style="margin-top:8px; font-size:11px; text-align:center;">
            ${((shopConfig && shopConfig.footer) || '')}
          </div>
        </div>
        <script>
          document.getElementById('printBtn').addEventListener('click', ()=>{ window.print(); });
          document.getElementById('closeBtn').addEventListener('click', ()=>{ window.close(); });
          const saveBtn = document.getElementById('saveBtn');
          if (saveBtn) {
            saveBtn.addEventListener('click', ()=>{
              try {
                window.opener.postMessage({ action: 'saveInvoice', invoice: ${JSON.stringify(invoice)}, printAfter: ${options.printAfter ? 'true' : 'false'} }, '*');
                window.close();
              } catch (e) { console.error(e); }
            });
          }
        </script>
      </body></html>
    `;
    win.document.write(html);
    win.document.close();
  };

  // View an existing saved invoice in printable preview (no save)
  const viewInvoice = async (invoiceNo) => {
    if (!isElectron) return;
    const r = await window.electronAPI.getInvoice(invoiceNo);
    if (!r.success) { setStatusMsg('❌ Invoice not found'); return; }
    const invoice = r.invoice;
    // open preview in thermal layout (narrow) to resemble receipt
    openInvoicePreview(invoice, { forSave: false, printAfter: false, thermal: true });
  };

  // Listen for preview window messages to perform save
  useEffect(() => {
    const onMessage = async (ev) => {
      const data = ev.data || {};
      if (data && data.action === 'saveInvoice') {
        const invoice = data.invoice;
        const printAfter = data.printAfter;
        // perform save now
        setStatusMsg('💾 Saving...');
        const saveResult = await window.electronAPI.saveInvoice(invoice);
        if (!saveResult.success) {
          setStatusMsg('❌ Save failed: ' + saveResult.error);
          return;
        }
        invoice.invoice_no = saveResult.invoice_no;
        invoice.created_at = new Date().toISOString();

        // Sync stock changes to Excel if a file is selected
        if (filePath) {
          const changes = invoice.items.map(i => ({ barcode: i.barcode, quantity: i.quantity }));
          const syncRes = await window.electronAPI.applyStockChanges({ filePath, changes, columnConfig, sheetName });
          if (!syncRes.success) {
            setStatusMsg('⚠️ Invoice saved but Excel sync failed: ' + syncRes.error);
          } else {
            setStatusMsg('✅ Saved & Inventory updated');
          }
        } else {
          setStatusMsg('✅ Saved! Invoice: ' + saveResult.invoice_no);
        }

        // After save, optionally print
        if (printAfter) {
          setStatusMsg('🖨️ Printing...');
          const printResult = await window.electronAPI.printReceipt({ invoice, shopConfig, printerName: selectedPrinter || undefined });
          if (printResult.success) setStatusMsg('✅ Saved & Printed! Invoice: ' + saveResult.invoice_no);
          else setStatusMsg('⚠️ Saved but print failed: ' + printResult.error);
        }

        // Clear cart UI
        setCartItems([]);
        setCustomerName('');
        setCustomerPhone('');
        setPaidCash('');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [filePath, columnConfig, sheetName, selectedPrinter, shopConfig]);

  const reprintInvoice = async (invoiceNo) => {
    const r = await window.electronAPI.getInvoice(invoiceNo);
    if (!r.success) return;
    setStatusMsg('🖨️ Reprinting...');
    const res = await window.electronAPI.printReceipt({
      invoice: r.invoice,
      shopConfig,
      printerName: selectedPrinter || undefined
    });
    setStatusMsg(res.success ? '✅ Reprinted!' : '❌ ' + res.error);
  };

  // Filtered product list
  const filteredProducts = products.filter(p =>
    !searchProd || (p.name || '').toLowerCase().includes(searchProd.toLowerCase())
      || (p.barcode || '').includes(searchProd)
  );

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="billing-root">
      {/* Sub-nav */}
      <div className="billing-nav">
        {['new', 'history', 'settings'].map(v => (
          <button key={v} className={`billing-nav-btn ${view === v ? 'active' : ''}`}
            onClick={() => setView(v)}>
            {v === 'new' ? '🧾 New Bill' : v === 'history' ? '📋 History' : '⚙️ Bill Settings'}
          </button>
        ))}
        {statusMsg && <span className="bill-status">{statusMsg}</span>}
      </div>

      {/* ── NEW BILL ─────────────────────────────────────────────────────── */}
      {view === 'new' && (
        <div className="billing-layout">
          {/* Left: product picker */}
          <div className="billing-products">
            <div className="billing-section-title">Products</div>
            <input className="bill-input" placeholder="Search product…"
              value={searchProd} onChange={e => setSearchProd(e.target.value)} />
            <div className="product-list">
              {filteredProducts.map(p => (
                <div key={p.barcode} className="product-card" onClick={() => addToCart(p)}>
                  <div className="product-card-name">{p.name}</div>
                  <div className="product-card-meta">
                    <span className="product-card-price">Rs. {fmt(p.price)}</span>
                    <span className={`product-card-stock ${p.quantity < 1 ? 'out' : ''}`}>
                      Stock: {p.quantity}
                    </span>
                  </div>
                </div>
              ))}
              {filteredProducts.length === 0 && (
                <div className="bill-empty">No products found. Add products in Barcode Creator tab first.</div>
              )}
            </div>
          </div>

          {/* Right: cart + bill summary */}
          <div className="billing-cart">
            <div className="billing-section-title">Bill</div>

            {/* Customer */}
            <div className="bill-row-2">
              <input className="bill-input" placeholder="Customer name (optional)"
                value={customerName} onChange={e => setCustomerName(e.target.value)} />
              <input className="bill-input" placeholder="Phone (optional)"
                value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} />
            </div>
            <input className="bill-input" placeholder="Cashier name"
              value={cashier} onChange={e => setCashier(e.target.value)} style={{ marginBottom: 8 }} />

            {/* Cart items */}
            {cartItems.length === 0
              ? <div className="bill-empty">Click a product to add it to the bill</div>
              : (
                <table className="cart-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Price</th>
                      <th>Disc.</th>
                      <th>Qty</th>
                      <th>Total</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cartItems.map(item => (
                      <tr key={item.barcode}>
                        <td>{item.name}</td>
                        <td>
                          <input type="number" className="cart-num-input" value={item.price}
                            onChange={e => updateCartItem(item.barcode, 'price', e.target.value)} />
                        </td>
                        <td>
                          <input type="number" className="cart-num-input" value={item.discount}
                            onChange={e => updateCartItem(item.barcode, 'discount', e.target.value)} />
                        </td>
                        <td>
                          <input type="number" className="cart-num-input" value={item.quantity}
                            min="1"
                            onChange={e => updateCartItem(item.barcode, 'quantity', e.target.value)} />
                        </td>
                        <td>Rs. {fmt(item.total)}</td>
                        <td>
                          <button className="cart-remove-btn" onClick={() => removeCartItem(item.barcode)}>×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }

            {/* Totals */}
            {cartItems.length > 0 && (
              <div className="bill-summary">
                <div className="bill-summary-row">
                  <span>Sub Total</span><span>Rs. {fmt(subtotal)}</span>
                </div>
                <div className="bill-summary-row">
                  <span>Total Discount</span><span>Rs. {fmt(totalDiscount)}</span>
                </div>
                <div className="bill-summary-row bold">
                  <span>Total</span><span>Rs. {fmt(total)}</span>
                </div>
                <div className="bill-summary-row">
                  <span>Paid Cash</span>
                  <input type="number" className="bill-input" style={{ width: 100, textAlign: 'right' }}
                    placeholder="0.00" value={paidCash}
                    onChange={e => setPaidCash(e.target.value)} />
                </div>
                <div className={`bill-summary-row bold ${balance > 0 ? 'outstanding' : 'paid'}`}>
                  <span>{balance > 0 ? 'Balance Due' : 'Change'}</span>
                  <span>Rs. {fmt(Math.abs(balance))}</span>
                </div>
              </div>
            )}

            {/* Printer selector */}
            {printers.length > 1 && (
              <select className="bill-input" value={selectedPrinter}
                onChange={e => setSelectedPrinter(e.target.value)} style={{ marginTop: 8 }}>
                <option value="">-- Select Printer --</option>
                {printers.map(p => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
            )}

            {/* Actions */}
            <div className="bill-actions">
              <button className="bill-btn secondary" onClick={() => handleSaveAndPrint(false)}>
                💾 Save Only
              </button>
              <button className="bill-btn primary" onClick={() => handleSaveAndPrint(true)}>
                🖨️ Save & Print
              </button>
            </div>
          </div>
        </div>
      )}

      {/* printable preview opens in a new window */}

      {/* ── HISTORY ──────────────────────────────────────────────────────── */}
      {view === 'history' && (
        <div className="billing-history">
          <table className="history-table">
            <thead>
              <tr>
                <th>Invoice No</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Total</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.invoice_no}>
                  <td className="mono">{inv.invoice_no}</td>
                  <td>{new Date(inv.created_at).toLocaleDateString()}</td>
                  <td>{inv.customer_name || '—'}</td>
                  <td>Rs. {fmt(inv.total)}</td>
                  <td>
                    <span className={`inv-badge ${inv.status}`}>{inv.status}</span>
                  </td>
                  <td>
                    <button className="hist-btn" onClick={() => viewInvoice(inv.invoice_no)} style={{ marginRight: 8 }}>
                      👁️ View
                    </button>
                    <button className="hist-btn" onClick={() => reprintInvoice(inv.invoice_no)}>
                      🖨️ Reprint
                    </button>
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr><td colSpan={6} className="bill-empty">No invoices yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── SETTINGS ─────────────────────────────────────────────────────── */}
      {view === 'settings' && (
        <ShopSettings shopConfig={shopConfig} setShopConfig={setShopConfig}
          printers={printers} selectedPrinter={selectedPrinter}
          setSelectedPrinter={setSelectedPrinter} />
      )}
    </div>
  );
}

function ShopSettings({ shopConfig, setShopConfig, printers, selectedPrinter, setSelectedPrinter }) {
  const [local, setLocal] = useState(shopConfig);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    if (window.electronAPI) {
      await window.electronAPI.saveShopConfig(local);
    }
    setShopConfig(local);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const f = (key) => ({
    value: local[key] || '',
    onChange: e => setLocal(p => ({ ...p, [key]: e.target.value }))
  });

  return (
    <div className="shop-settings">
      <div className="billing-section-title">Shop / Receipt Settings</div>
      <label>Shop Name</label>
      <input className="bill-input" {...f('name')} placeholder="e.g. DisplayHub.lk" />
      <label>Tagline</label>
      <input className="bill-input" {...f('tagline')} placeholder="e.g. Wholesale Mobile Parts Solution" />
      <label>Address</label>
      <input className="bill-input" {...f('address')} placeholder="e.g. 152, High Level Road, Maharagama" />
      <label>Phone</label>
      <input className="bill-input" {...f('phone')} placeholder="e.g. 0777 119 126" />
      <label>Logo Path</label>
      <input className="bill-input" {...f('logo')} placeholder="/logo.png or C:\\path\\to\\logo.png" />
      <label>Default Cashier</label>
      <input className="bill-input" {...f('cashier')} placeholder="e.g. Binuja" />
      <label>Footer Note</label>
      <input className="bill-input" {...f('footer')} placeholder="e.g. Thank you for your purchase!" />

      <div className="billing-section-title" style={{ marginTop: 16 }}>Printer</div>
      <label>Select Receipt Printer</label>
      <select className="bill-input" value={selectedPrinter}
        onChange={e => setSelectedPrinter(e.target.value)}>
        <option value="">-- Default Printer --</option>
        {printers.map(p => (
          <option key={p.name} value={p.name}>{p.name}</option>
        ))}
      </select>
      <p className="bill-hint">Select your thermal printer from the list above. If not shown, make sure it's installed in Windows Printers & Scanners.</p>

      <button className="bill-btn primary" onClick={handleSave} style={{ marginTop: 16 }}>
        {saved ? '✅ Saved!' : '💾 Save Settings'}
      </button>
    </div>
  );
}