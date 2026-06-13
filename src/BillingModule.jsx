import { useState, useEffect, useCallback, useRef, useMemo, useDeferredValue } from 'react';
import { formatCurrency, formatNumber } from './utils/format';

let invoiceSequence = 0;
const generateInvoiceNumber = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const suffix = String(invoiceSequence++ % 100000).padStart(5, '0');
  return `INV-${year}-${month}${day}-${suffix}`;
};

export default function BillingModule({ isReturnsOnly = false, isUsedPurchaseWindow = false }) {
  const [view, setView] = useState('new'); // 'new' | 'history' | 'settings'
  const [products, setProducts] = useState([]);
  const [cartItems, setCartItems] = useState([]);
  const [searchProd, setSearchProd] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [cashier, setCashier] = useState('');
  const [paidCash, setPaidCash] = useState('');
  const [transactionMode, setTransactionMode] = useState(
    isUsedPurchaseWindow ? 'used_purchase' : isReturnsOnly ? 'supplier_return' : 'sale'
  );
  const [returnCompany, setReturnCompany] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [invoices, setInvoices] = useState([]);
  // printable preview is opened in a new window; no modal state required
  const [shopConfig, setShopConfig] = useState({});
  const [printers, setPrinters] = useState([]);
  const [selectedPrinter, setSelectedPrinter] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [isElectron] = useState(!!window.electronAPI);
  const productsRef = useRef([]);
  const productLookupRef = useRef(new Map());

  const barcodeText = (value) => (value === null || value === undefined ? '' : String(value));

  const refreshProducts = useCallback(async () => {
    if (!isElectron) return;
    const r = await window.electronAPI.getProducts({ billingOnly: true });
    if (r.success) setProducts(r.products || []);
  }, [isElectron]);

  // Load products, shop config, printers on mount
  useEffect(() => {
    if (!isElectron) return;
    const timer = setTimeout(() => {
      void refreshProducts();
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
    }, 0);
    return () => clearTimeout(timer);
  }, [isElectron, refreshProducts]);

  // Warranty options
  const WARRANTY_OPTIONS = ['No warranty', '7 days', '1 month', '3 months', '6 months', '1 year', '2 years', '3 years', '5 years'];

  const loadInvoices = useCallback(() => {
    if (!isElectron) return;
    window.electronAPI.getInvoices(100).then(r => {
      if (r.success) setInvoices(r.invoices);
    });
  }, [isElectron]);

  useEffect(() => {
    if (view === 'history') loadInvoices();
  }, [view, loadInvoices]);

  useEffect(() => {
    const handleRestoredData = () => {
      void refreshProducts();
      loadInvoices();
      window.electronAPI?.getShopConfig().then(cfg => {
        setShopConfig(cfg || {});
        if (cfg?.cashier) setCashier(cfg.cashier);
      });
    };

    window.addEventListener('data:restored', handleRestoredData);
    return () => window.removeEventListener('data:restored', handleRestoredData);
  }, [loadInvoices, refreshProducts]);

  useEffect(() => {
    productsRef.current = products;
    const lookup = new Map();
    for (const product of products) {
      lookup.set(barcodeText(product?.barcode), product);
    }
    productLookupRef.current = lookup;
  }, [products]);

  // When switching to supplier return, clear discounts and warranties from cart items
  useEffect(() => {
    if (transactionMode === 'supplier_return') {
      const timer = setTimeout(() => {
        setCartItems(prev => prev.map(i => ({
          ...i,
          discount: 0,
          warranty: '',
          remaining_warranty: '',
          net_price: i.price,
          total: (i.price || 0) * (i.quantity || 0)
        })));
      }, 0);
      return () => clearTimeout(timer);
    }

    if (transactionMode === 'customer_return') {
      // For customer returns: preserve price, remove discounts and allow entering remaining warranty
      const timer = setTimeout(() => {
        setCartItems(prev => prev.map(i => ({
          ...i,
          discount: 0,
          remaining_warranty: i.remaining_warranty || '',
          warranty: i.warranty || '',
          net_price: i.price,
          total: (i.price || 0) * (i.quantity || 0)
        })));
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [transactionMode]);

  // ── Cart logic ──────────────────────────────────────────────────────────────
  const addToCart = useCallback((product) => {
    const productBarcode = barcodeText(product?.barcode);
    setCartItems(prev => {
      const existing = prev.find(i => barcodeText(i.barcode) === productBarcode);
      if (existing) {
        return prev.map(i => barcodeText(i.barcode) === productBarcode
          ? { ...i, quantity: i.quantity + 1, total: (i.quantity + 1) * i.net_price, warranty: transactionMode === 'supplier_return' ? '' : (i.warranty || product.warranty || '7 days') }
          : i
        );
      }
      return [...prev, {
        barcode: productBarcode,
        name: product.name,
        warranty: transactionMode === 'supplier_return' ? '' : (product.warranty || '7 days'),
        remaining_warranty: transactionMode === 'customer_return' ? (product.remaining_warranty || '') : '',
        price: product.price,
        discount: 0,
        net_price: product.price,
        quantity: 1,
        total: product.price,
      }];
    });
  }, [transactionMode]);

  const resolveScannedProduct = useCallback(async (barcode) => {
    const bc = barcodeText(barcode);
    if (!bc) return null;

    let prod = productLookupRef.current.get(bc) || null;
    if (prod) return prod;

    if (isElectron) {
      const direct = await window.electronAPI.getProduct(bc);
      if (direct.success && direct.product) {
        prod = direct.product;
        if (prod?.scan_mode === 'inventory_only') return null;
        setProducts(prev => {
          const exists = prev.some(p => barcodeText(p.barcode) === bc);
          return exists ? prev : [direct.product, ...prev];
        });
        productLookupRef.current.set(bc, direct.product);
        return prod;
      }
    }

    return null;
  }, [isElectron]);

  const updateCartItem = (barcode, field, value) => {
    const targetBarcode = barcodeText(barcode);
    setCartItems(prev => prev.map(item => {
      if (barcodeText(item.barcode) !== targetBarcode) return item;
      const updated = { ...item };
      // In supplier return mode, ignore discount and warranty edits
      if (transactionMode === 'supplier_return' && (field === 'discount' || field === 'warranty')) {
        return updated;
      }
      if (field === 'warranty') {
        updated.warranty = value;
      } else if (field === 'remaining_warranty') {
        // free-text remaining warranty for customer returns
        updated.remaining_warranty = value;
      } else {
        updated[field] = parseFloat(value) || 0;
        const net = updated.price - (updated.discount || 0);
        updated.net_price = net;
        updated.total = net * updated.quantity;
      }
      return updated;
    }));
  };

  const changeQty = (barcode, delta) => {
    const targetBarcode = barcodeText(barcode);
    setCartItems(prev => prev.map(item => {
      if (barcodeText(item.barcode) !== targetBarcode) return item;
      const q = Math.max(0, (item.quantity || 0) + delta);
      const updated = { ...item, quantity: q };
      if (transactionMode === 'supplier_return') {
        updated.net_price = updated.price;
        updated.total = updated.price * updated.quantity;
      } else {
        const net = updated.price - (updated.discount || 0);
        updated.net_price = net;
        updated.total = net * updated.quantity;
      }
      return updated;
    }).filter(i => i.quantity > 0));
  };

  const removeCartItem = (barcode) => {
    const targetBarcode = barcodeText(barcode);
    setCartItems(prev => prev.filter(i => barcodeText(i.barcode) !== targetBarcode));
  };

  // ── Totals ──────────────────────────────────────────────────────────────────
  const isSupplierReturn = transactionMode === 'supplier_return';
  const isCustomerReturn = transactionMode === 'customer_return';
  const subtotal = cartItems.reduce((s, i) => s + i.price * i.quantity, 0);
  const totalDiscount = (isSupplierReturn || isCustomerReturn) ? 0 : cartItems.reduce((s, i) => s + (i.discount || 0) * i.quantity, 0);
  const total = (isSupplierReturn || isCustomerReturn) ? subtotal : cartItems.reduce((s, i) => s + i.total, 0);
  const balance = total - (parseFloat(paidCash) || 0);

  // Use shared currency formatter
  const fmt = (n) => formatCurrency(n);

  // ── Save & Print ────────────────────────────────────────────────────────────
  const handleSaveAndPrint = async (printAfter = true) => {
    // Build invoice and open preview for confirmation before saving
    if (cartItems.length === 0) { setStatusMsg('❌ Cart is empty'); return; }
    if (isSupplierReturn && !returnCompany.trim()) {
      setStatusMsg('❌ Enter supplier/company name for return');
      return;
    }

    const transactionType = isSupplierReturn ? 'supplier_return' : (isCustomerReturn ? 'customer_return' : 'sale');
    const invoiceNo = generateInvoiceNumber();
    const invoice = {
      invoice_no: invoiceNo,
      customer_name: isSupplierReturn ? returnCompany.trim() : customerName,
      customer_phone: isSupplierReturn ? '' : customerPhone,
      cashier,
      subtotal,
      discount: totalDiscount,
      total,
      paid_cash: isSupplierReturn ? 0 : (parseFloat(paidCash) || 0),
      balance: isSupplierReturn ? 0 : balance,
      status: transactionType === 'supplier_return' ? 'supplier_return' : (balance <= 0 ? 'paid' : 'unpaid'),
      transaction_type: transactionType,
      return_reason: isSupplierReturn ? returnReason.trim() : '',
      items: cartItems
    };

    // Open preview window for confirmation; when printing requested show thermal layout
    openInvoicePreview(invoice, { forSave: true, printAfter, thermal: !!printAfter });
  };

  // Shared Oshini Mobile logo (base64) — same as print-handler
  const OSHINI_LOGO_B64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAYGBgYHBgcICAcKCwoLCg8ODAwODxYQERAREBYiFRkVFRkVIh4kHhweJB42KiYmKjY+NDI0PkxERExfWl98fKcBBgYGBgcGBwgIBwoLCgsKDw4MDA4PFhAREBEQFiIVGRUVGRUiHiQeHB4kHjYqJiYqNj40MjQ+TERETF9aX3x8p//CABEIBAAGAAMBIgACEQEDEQH/xAAxAAEBAAIDAQAAAAAAAAAAAAAAAQIFAwQGBwEBAQEBAQAAAAAAAAAAAAAAAAECAwT/2gAMAwEAAhADEAAAAvMhAAKgqCgAWBQJQAACgAAAAoABRKAAACgCgAsoFALFJZRZQBZQDJBUGSUWUWQzSluNMpKLKVC0CymQCUAsoQFgqQsoJCywY3EyIZSRLjRCElhFhFgAlglglxFgEEsAICgksLAiwsUiwgAAEsABAAACKIAACLAACglAAACoKAAACgAAsUigACgAAALBQoAAKlKCAoKAoSiwLZSyUoLcaZSUFChZDKwZWFEMrKWBQIyFxGUAsACUhCyCxCoLESwJYLiElgIWWEIWWCIWAlEICFgJYWWAhYACWAACWAAEWAACWAAEURYAQAFAAAAAqFAAABQAAALKAAAUAAoICkoVBQAKhQWBUFBbBQLBUGSUWC2CgoKlKlBDKwuSC2CoMgZSCxSyggyxAQyxBFJAQSywEEsEsEBEKQsQsCSwECCwAIsBCwAEAQAAELAAILAAJRAAAELAAgAFAAAAACpQCgQKgoJZQACpQAAACgoAJQsUEKlAKACoLYKlKgtxooAVQuNBDKwUoIZMaWhUoC5RSFQsWgyiAFliJRJS3EARAiwsgLiWIJYJRAEhYEIWAgAJYAAQCAAlgAlEsAAEAAABAAAIAAEABUAoAABUoSgAAFSgAACgAAAAoLBYFABYBYAUFAAKEyJQUAFQyQLBahUpVxMkosoBkuJShKUKsosFAIW4jKCJYXGlQEEuNgmUEBIBACLgVKIAGKwSwSgBLAQoIBAEKlEsAIAAgAAAIAAEsAAAIACgAAAAoAAAABQCgJQQoAAAKAohQABQllAFlICgUBCgySiwVKVAqFoLBSgFTIQMoKUUFShKLKUACBUCoEGWGUBEIC4iWGNuJccoAICBAAQElCAIFEsCABFgBKCWACWCWFikAAAlgAABFEAIAAUAAACygAAAACygCwUEsFAAABQCiBUFBUoQUAFSgFQWBSlSiyhBQAWygFsFSlTISipVsCgoBQxpklLLBLCwEQqQzxohCxCwSAQIQsAlICSwASwSwAsBLABAAgAAEAAQAgAACCwAACCkLAiwAAoAAAFlBCpQAABQAWCoFgKAABSVCkKACgAAoAFAAsFlKCpSVQgoChccgBQrHIsCgykyFlUCoALZSpYJRKJUEqpMsRFJAssIoksEELBjRAJYASUJYAQCWACWABAAAAlgBAAJRAAARYAAAIAAEABUFSgAAFAAAAAsoAKRYAUBKAAKAAAFAABQAVBQLBQUAGUAAUKAKlLKFBKMoosGUpSCgsqCUqUWUELMoJYSZQSwiwgpjlBLAuJcbELiAJYJYIogJYEolEAlgIUCAIUEAAlgAAlgAIUEAAlgAAIAALBQAAAKAAAApKAAFlgAKAACgAACwUAAFAAsoBQALBQVAspZYZILZSpSywFFFAtgoKgqZCxAoBZcjBnBKEUkoxZQxmUJMoY1BLKEEsRLAQsCVBLBLACwEABAAAiwAQABCwAAEsLAAAQAAIsAAIACgAAAAAWCgAoAAAAAFgoACwqCgFIAUAFICgqUAsolCgAAoKACgqVbKKlFCgAqUAyxqKUync20vn76mx5W+qleWepJ5aeqHlXqoeVeqL5SesR5OetHkXrYeTw9Lp66MylmMspBCwELLBLBASwAgECkABCoLAQAABAAsAEsAABAAACAAAgFAAAAAAUAAAWCpQACwFlICgAqACgAAAoAKgygCgCwUFQVKLBbBklALJVVDJKWoZCDKCBkxVlCFDk23T9Tzqa3xsvt8fBNz3t8Cr3zwI99PBD3rwQ968FD3zwKPevBD3rwUj6Xn849hi4aD3XltzWS49IACIhZYIFlglEmUIABKBABLACAAAgAACUQABAAACWUiwASwAqUAAJQABYKAQoACgAAAAACgAWCgAAqCgAWUSigELZQAQySlACsgILYjKUUBaShSiXEtguNETA9hzc2i4a8phcu+cLlbMGYwnIOfLa3OtQ24092487Obj1nGZjBnDDJiv0G6L0/n34SZ4d8EWWAgWICGSBLBLAABKIAQsBLCggAIAAABALBKIAABKIABLABYKCAUAAFgqACgAoAAAFgoJQAAWUSgAAAsKCkKCpQlAKgoKQo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mz+4z8z4+036x95z0/8A9vONum8sPWU3nFXmV333032F20121Xn301HEFX032lXUEV332HWnE8Pd66IOs9d8ffOcd9sI/ct9dv8A199NPH3rjdLfvDzD3DvHLLLrXHBJFB19tR9ZBpBx79B99pVND99tBRFJhB5hFd9BpV5FpF/PDH//AD/4z69wwwzyw0/7/wDP8P8A/HVFnHvXLvz3r/HPLrfrXff7jvN1lxd95h15Fd55VtFVpBBFBRpBBBR19tNJB99B19V9Bp1xPvLPzbb/AF0a6zzwy0631yyz+03x1yzw709w08z8xB12x8zw174YaffRfZWQbTffeWcffTafcRTQQQQRbaUVfcfebQfeYccZba5614w/31rN7Cwx4qPohzwrV/H+2wl55wl+6w48t5926wy/w4y6ccYSXfbQRdcZWfbffeXeZXaQQdSZUaQccQccfecffTQUck88zz3+/wDsVb1sMdvTG3NcWXLr/NuU+P8AYXzrP3i5EDzG/H37iPF9NJ19pBNddth9dtB9VxhBBV5BttBBt9FBBBFhFJV9lJb+y+uQu6H33/fRHfjw04r/AIwPKhr+6z2/wyc2Y042nhNz9XM/eQh9ffSXfbcQUfYReURScfTUQQReQUXfadfUdbRfTVQdSQVYfzz+w/8A9dfnjNpfNdqzzNe+x1sav/ddf88adQNv9VDH9fP/ADDf/vX595hxhBx1NJN9xBBR9FRBB999tdN9V9BF9x9BBBlxBB5n7z/P3v33z3P/ADw6xz5x/wBfPe9v+9fcss9dNOPdecevNPf+8M9sMUk032332EEEEVG112VFFUEG0F33331XkE21XkHHHnU1/vvet8OfvesMv99t4uPdONPq/tu8ONM7udfOvfuet9Yf+u/vWcNeMGlG30mn320kG32FEEFGHmH3HG02kEV203GH2E00H333nNy2jHH3psuMf8W//OOtuOM9OuNtsedus8dteuvd9/8Af7HqQAQwY5JBBxBlNBBRhBT/AAQcQQUZTYRfffeeUccYQQfcffTffcQRTww//wD/APLXDjHvj7brPHnfbDLLTvxn7P7zrnLf/L7DnbDXT7z3Lpt59FBFNtdxBJVtJFN5hhVVl99BBBxhNZ5BthBhBV99tNRlJtN9NB5FzBpBNZ91p9Ztx9Bx9tV9NNRx15DXjjxlNNtPZ9Bd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';

  // Build receipt HTML identical to print-handler.cjs so preview matches the printed receipt
  const buildReceiptHTML = (invoice, options = {}) => {
    const shop = shopConfig || {};
    // no local toFixed formatter — use shared `fmt` above for consistent formatting
    const isReturnInvoice = invoice?.transaction_type === 'supplier_return' || invoice?.transaction_type === 'customer_return';
    const warrantyText = (invoice.transaction_type === 'customer_return')
      ? ([...new Set((invoice.items || []).map((item) => (item.remaining_warranty || '').trim()).filter(Boolean))].join(', ') || '—')
      : (isReturnInvoice ? '' : ([...new Set((invoice.items || [])
        .map((item) => (item.warranty || '').trim())
        .filter(Boolean))].join(', ') || '—'));

    const itemRows = (invoice.items || []).map((item, i) => `
      <tr>
        <td class="item-name">${i + 1}) ${item.name || item.barcode}${item.barcode ? ' - ' + item.barcode : ''}</td>
      </tr>
      <tr>
        <td>
          <table class="item-detail-row">
            <tr>
              <td class="r">${fmt(item.price)}</td>
              ${isReturnInvoice ? '' : `<td class="r">${fmt(item.discount || 0)}</td><td class="r">${fmt(item.net_price)}</td>`}
              <td class="r">${formatNumber(item.quantity || 0, { maximumFractionDigits: 0 })}</td>
              <td class="r">${fmt(item.total)}</td>
            </tr>
          </table>
        </td>
      </tr>
    `).join('');

    const shopName = shop.name || 'Oshini Mobile';
    const buildBarcodeSvg = (value) => {
      const code = String(value || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase() || '000000';
      let width = 0;
      const bars = [];
      const barY = 2;
      const barHeight = 40;
      for (const ch of code) {
        const codePoint = ch.charCodeAt(0);
        const barWidth = 1 + (codePoint % 3);
        const gapWidth = 1 + (codePoint % 2);
        for (let i = 0; i < 3; i += 1) {
          bars.push(`<rect x="${width}" y="${barY}" width="${barWidth}" height="${barHeight}" fill="#000" />`);
          width += barWidth + gapWidth;
        }
        width += 2;
      }
      const viewWidth = Math.max(width, 120);
      return `<svg class="barcode-svg" viewBox="0 0 ${viewWidth} 44" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${bars.join('')}</svg>`;
    };
    const shopAddr = shop.address || '';
    const shopPhone = shop.phone || '';

    const invoiceDate = invoice.created_at
      ? new Date(invoice.created_at).toLocaleString('en-GB').replace(',', '')
      : new Date().toLocaleString('en-GB').replace(',', '');

    const invoiceNo = invoice.invoice_no || '';
    const cashier = invoice.cashier || shop.cashier || '';
    const customer = invoice.customer_name || '';
    const custPhone = invoice.customer_phone || '';

    const balVal = parseFloat(invoice.balance || 0);
    const balanceDisplay = balVal > 0
      ? `[-${fmt(Math.abs(balVal))}]`
      : `${fmt(balVal)}`;

    const outstandingSection = balVal !== 0 ? `
      <div class="divider"></div>
      <div class="bold center">Outstanding : ${fmt(Math.abs(balVal))}</div>
    ` : '';

    const saveButtons = options.forSave
      ? `<button id="saveBtn" style="background:#1a7f3c;color:#fff;border:none;padding:8px 18px;font-size:13px;border-radius:4px;cursor:pointer;margin-right:6px;">✔ Confirm &amp; Save</button>`
      : '';

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<title>Invoice ${invoiceNo}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 11px;
    width: 72mm;
    margin: 0 auto;
    padding: 4mm 3mm 8mm 3mm;
    color: #000;
    background: #fff;
    font-weight: 500;
    line-height: 1.25;
    text-rendering: geometricPrecision;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .center  { text-align: center; }
  .bold    { font-weight: 700; }
  .receipt-header { text-align: center; margin-bottom: 3px; }
  .shop-name { font-size: 11px; font-weight: 700; letter-spacing: 0.1px; }
  .logo-wrap { text-align: center; margin-bottom: 3px; }
  .logo-wrap img { width: 30mm; max-height: 18mm; object-fit: contain; }
  .shop-tagline { font-size: 8px; text-align: center; letter-spacing: 0.6px; }
  .shop-address { font-size: 9px; text-align: center; line-height: 1.3; font-weight: 500; }
  .shop-phone   { font-size: 9px; text-align: center; line-height: 1.3; font-weight: 500; }
  .divider-solid { border-top: 1px solid #000; margin: 3px 0; }
  .divider       { border-top: 1px dashed #000; margin: 3px 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 1px 2px; font-size: 10.5px; }
  th { font-weight: 700; }
  .header-row th { border-bottom: 1px solid #000; font-size: 10.5px; }
  .r { text-align: right; }
  .item-name { font-size: 10.5px; padding-top: 3px; font-weight: 500; }
  .item-detail-row { width: 100%; }
  .item-detail-row td { font-size: 10.5px; padding: 0 2px; }
  .summary-table td { padding: 1.5px 2px; font-size: 10.5px; }
  .summary-table .total-row td { font-weight: 700; font-size: 12px; }
  .balance-card { margin-top: 4px; padding: 4px 0 3px; text-align: center; border-top: 1px solid #000; border-bottom: 1px solid #000; }
  .balance-card.due { background: #f4f4f4; }
  .balance-card.change { background: #fff8e6; }
  .balance-label { font-size: 8.5px; letter-spacing: 0.5px; text-transform: uppercase; font-weight: 500; }
  .balance-value { font-size: 15px; font-weight: 700; line-height: 1.1; }
  .barcode-area { margin-top: 4px; text-align: center; }
  .barcode-svg { width: 100%; height: 60px; display: block; min-height: 50px; }
  .barcode-text { font-size: 8px; letter-spacing: 1px; margin-top: 2px; }
  .footer-text { font-size: 8.5px; text-align: center; margin-top: 2px; line-height: 1.35; }
  .screen-actions {
    display: flex; gap: 8px; justify-content: center;
    margin: 12px 0 4px 0;
  }
  .screen-actions button {
    background: #333; color: #fff; border: none;
    padding: 8px 18px; font-size: 13px;
    border-radius: 4px; cursor: pointer;
  }
  .screen-actions button:hover { background: #555; }
  @media print {
    @page { margin: 0; size: 72mm auto; }
    body { width: 72mm; margin: 0; padding: 4mm 3mm; }
    .screen-actions { display: none !important; }
  }
</style>
</head>
<body>

  <div class="receipt-header">
    ${shopName ? `<div class="shop-name">${shopName}</div>` : ''}
    ${shopAddr ? `<div class="shop-address">${shopAddr}</div>` : ''}
    ${shopPhone ? `<div class="shop-phone">Tel: ${shopPhone}</div>` : ''}
  </div>

  <div class="logo-wrap">
    <img src="data:image/jpeg;base64,${OSHINI_LOGO_B64}" alt="${shopName}" />
  </div>

  <div style="font-size:9.5px; text-align:center; margin-top:2px; font-weight:500;">Date ${invoiceDate}</div>
  <div style="font-size:9.5px; text-align:center; font-weight:500;"># ${invoiceNo}</div>
  ${cashier ? `<div style="font-size:9.5px; text-align:center; font-weight:500;">Cashier : ${cashier}</div>` : ''}
  ${customer ? `<div style="font-size:9.5px; text-align:center; font-weight:500;">Customer : ${customer}${custPhone ? '  ' + custPhone : ''}</div>` : ''}

  <div class="divider"></div>
  <div class="center bold" style="font-size:11px; font-weight:700;">Receipt - Original</div>
  <div class="divider"></div>

  <!-- Items header -->
  <table>
    <thead>
      <tr class="header-row">
        <th>#Item</th>
        <th class="r">Price</th>
        ${isReturnInvoice ? '' : '<th class="r">Save</th><th class="r">Net</th>'}
        <th class="r">Qty</th>
        <th class="r">Total</th>
      </tr>
    </thead>
  </table>

  <!-- Items -->
  <table><tbody>${itemRows}</tbody></table>

  <div class="divider-solid"></div>

  <!-- Summary -->
  <table class="summary-table">
    <tr><td>Sub Total</td><td class="r">${fmt(invoice.subtotal)}</td></tr>
    ${isReturnInvoice ? '' : `<tr><td>Total Discount</td><td class="r">${fmt(invoice.discount)}</td></tr>`}
    ${isReturnInvoice ? '' : `<tr><td>Warranty</td><td class="r">${warrantyText}</td></tr>`}
    <tr class="total-row"><td>Total</td><td class="r">${fmt(invoice.total)}</td></tr>
    <tr><td>Paid Cash</td><td class="r">${fmt(invoice.paid_cash)}</td></tr>
    <tr class="balance-row"><td>Balance</td><td class="r">${balanceDisplay}</td></tr>
  </table>

  ${outstandingSection}

  ${balVal !== 0 ? `
  <div class="balance-card ${balVal > 0 ? 'due' : 'change'}">
    <div class="balance-label">${balVal > 0 ? 'Balance Due' : 'Change'}</div>
    <div class="balance-value">Rs. ${fmt(Math.abs(balVal))}</div>
  </div>
  ` : ''}

  <!-- Barcode -->
  <div class="barcode-area">
    ${buildBarcodeSvg(invoiceNo)}
    <div class="barcode-text">${invoiceNo}</div>
  </div>

  <div class="divider"></div>
  <div class="footer-text">${shop.footer || '*** Thank you for shopping with us ***'}</div>

  <!-- On-screen action buttons (hidden when printing) -->
  <div class="screen-actions">
    <button onclick="window.print()">🖨️ Print</button>
    ${saveButtons}
    <button onclick="window.close()">✕ Close</button>
  </div>

  <script>
    const saveBtn = document.getElementById('saveBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        try {
          window.opener.postMessage(
            { action: 'saveInvoice', invoice: ${JSON.stringify(invoice)}, printAfter: ${options.printAfter ? 'true' : 'false'} },
            '*'
          );
          window.close();
        } catch (e) { console.error(e); }
      });
    }
  </script>
</body>
</html>`;
  };

  // Open a printable preview in a new window. Options: { forSave: bool, printAfter: bool }
  const openInvoicePreview = (invoice, options = {}) => {
    const win = window.open('', '_blank', 'width=380,height=900');
    const html = buildReceiptHTML(invoice, options);
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
        const isReturn = invoice?.status === 'supplier_return' || invoice?.status === 'customer_return' ||
          invoice?.transaction_type === 'supplier_return' || invoice?.transaction_type === 'customer_return';
        // perform save now
        setStatusMsg('💾 Saving...');
        const saveResult = await window.electronAPI.saveInvoice(invoice);
        if (!saveResult.success) {
          setStatusMsg('❌ Save failed: ' + saveResult.error);
          return;
        }
        invoice.invoice_no = saveResult.invoice_no;
        invoice.created_at = new Date().toISOString();

        // Notify inventory that stock has changed (DB update is handled by saveInvoice)
        window.dispatchEvent(new Event('products:changed'));
        setStatusMsg(`✅ ${isReturn ? 'Supplier return saved' : 'Saved'}! Invoice: ` + saveResult.invoice_no);

        // After save, optionally print
        if (printAfter) {
          setStatusMsg('🖨️ Printing...');
          const printResult = await window.electronAPI.printReceipt({ invoice, shopConfig, printerName: selectedPrinter || undefined });
          if (printResult.success) {
            setStatusMsg(`✅ ${isReturn ? 'Supplier return saved & Printed' : 'Saved & Printed'}! Invoice: ` + saveResult.invoice_no);
          } else {
            setStatusMsg(`⚠️ ${isReturn ? 'Supplier return saved' : 'Saved'} but print failed: ` + printResult.error);
          }
        }

        // Clear cart UI
        setCartItems([]);
        setCustomerName('');
        setCustomerPhone('');
        setReturnCompany('');
        setReturnReason('');
        setPaidCash('');
      }
    };
    window.addEventListener('message', onMessage);

    const onProductsChanged = () => {
      refreshProducts();
    };
    window.addEventListener('products:changed', onProductsChanged);

    // listen for billing scan events from global scanner
    const onGlobal = async (ev) => {
      const d = ev.data || {};
      if (d && d.action === 'billing:scan' && d.barcode) {
        const bc = barcodeText(d.barcode);
        const prod = await resolveScannedProduct(bc);
        if (prod) {
          addToCart(prod);
        } else {
          setStatusMsg('⚠️ Product not found for barcode: ' + bc);
        }
      }
    };
    window.addEventListener('message', onGlobal);
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('message', onGlobal);
      window.removeEventListener('products:changed', onProductsChanged);
    };
  }, [addToCart, selectedPrinter, shopConfig, refreshProducts, isElectron, resolveScannedProduct]);

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
  const deferredSearchProd = useDeferredValue(searchProd);
  const filteredProducts = useMemo(() => {
    const query = deferredSearchProd.trim().toLowerCase();
    return products.filter(p => {
      if (p.scan_mode === 'inventory_only') return false;
      if (!query) return true;
      return (p.name || '').toLowerCase().includes(query)
        || (p.barcode || '').includes(query)
        || (p.sku || '').toLowerCase().includes(query)
        || (p.category || '').toLowerCase().includes(query);
    });
  }, [deferredSearchProd, products]);

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
                      {p.quantity < 1 ? 'Out of Stock' : `Stock: ${p.quantity}`}
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

            {(!isReturnsOnly && !isUsedPurchaseWindow) && (
              <div className="bill-mode-toggle" style={{ marginBottom: 8 }}>
                <button
                  className={`billing-nav-btn ${transactionMode === 'sale' ? 'active' : ''}`}
                  onClick={() => setTransactionMode('sale')}
                  type="button"
                >
                  🧾 Sale
                </button>
                <button
                  className={`billing-nav-btn ${transactionMode === 'customer_return' ? 'active' : ''}`}
                  onClick={() => setTransactionMode('customer_return')}
                  type="button"
                >
                  ↩️ Customer Return
                </button>
                <button
                  className={`billing-nav-btn ${transactionMode === 'supplier_return' ? 'active' : ''}`}
                  onClick={() => setTransactionMode('supplier_return')}
                  type="button"
                >
                  ↩️ Supplier Return
                </button>
              </div>
            )}

            {/* Customer */}
            {isUsedPurchaseWindow ? (
              <>
                <input className="bill-input" placeholder="Seller / Customer name"
                  value={customerName} onChange={e => setCustomerName(e.target.value)} />
                <input className="bill-input" placeholder="Seller contact number"
                  value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} style={{ marginBottom: 8 }} />
              </>
            ) : isSupplierReturn ? (
              <>
                <input className="bill-input" placeholder="Company / Supplier name"
                  value={returnCompany} onChange={e => setReturnCompany(e.target.value)} />
                <input className="bill-input" placeholder="Return reason (fault, damage, etc.)"
                  value={returnReason} onChange={e => setReturnReason(e.target.value)} style={{ marginBottom: 8 }} />
              </>
            ) : (
              <div className="bill-row-2">
                <input className="bill-input" placeholder="Customer name (optional)"
                  value={customerName} onChange={e => setCustomerName(e.target.value)} />
                <input className="bill-input" placeholder="Phone (optional)"
                  value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} />
              </div>
            )}
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
                      {!(isSupplierReturn || isCustomerReturn) && <th>Disc.</th>}
                      {isCustomerReturn && <th>Remaining Warranty</th>}
                      {!isSupplierReturn && !isCustomerReturn && <th>Warranty</th>}
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
                        {!(isSupplierReturn || isCustomerReturn) && (
                          <td>
                            <input type="number" className="cart-num-input" value={item.discount}
                              onChange={e => updateCartItem(item.barcode, 'discount', e.target.value)} />
                          </td>
                        )}
                        {isCustomerReturn && (
                          <td>
                            <select className="bill-input" value={item.remaining_warranty || 'No warranty'}
                              onChange={e => updateCartItem(item.barcode, 'remaining_warranty', e.target.value)}>
                              {WARRANTY_OPTIONS.map(w => <option key={w} value={w}>{w}</option>)}
                            </select>
                          </td>
                        )}
                        {!isSupplierReturn && !isCustomerReturn && (
                          <td>
                            <select className="bill-input" value={item.warranty || '7 days'}
                              onChange={e => updateCartItem(item.barcode, 'warranty', e.target.value)}>
                              {WARRANTY_OPTIONS.map(w => <option key={w} value={w}>{w}</option>)}
                            </select>
                          </td>
                        )}
                        <td>
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                            <button className="cart-qty-btn" onClick={() => changeQty(item.barcode, -1)}>-</button>
                            <input type="number" className="cart-num-input" value={item.quantity}
                              min="1"
                              onChange={e => updateCartItem(item.barcode, 'quantity', e.target.value)} />
                            <button className="cart-qty-btn" onClick={() => changeQty(item.barcode, 1)}>+</button>
                          </div>
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
                {!isSupplierReturn && (
                  <>
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
                  </>
                )}
                {isSupplierReturn && (
                  <div className="bill-summary-row bold outstanding">
                    <span>Stock Movement</span>
                    <span>-{cartItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)} units</span>
                  </div>
                )}
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
              {!isSupplierReturn ? (
                <>
                  <button className="bill-btn secondary" onClick={() => handleSaveAndPrint(false)}>
                    💾 Save Only
                  </button>
                  <button className="bill-btn primary" onClick={() => handleSaveAndPrint(true)}>
                    🖨️ Save & Print
                  </button>
                </>
              ) : (
                <>
                  <button className="bill-btn secondary" onClick={() => handleSaveAndPrint(false)}>
                    ↩️ Save Supplier Return
                  </button>
                  <button className="bill-btn secondary" onClick={() => handleSaveAndPrint(true)}>
                    ↩️ Save & Print Return
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── HISTORY ──────────────────────────────────────────────────────── */}
      {view === 'history' && (
        <div className="billing-history">
          <table className="history-table">
            <thead>
              <tr>
                <th>Invoice No</th>
                <th>Date</th>
                <th>Type</th>
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
                  <td>{inv.transaction_type === 'supplier_return' ? 'Supplier Return' : 'Sale'}</td>
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
                <tr><td colSpan={7} className="bill-empty">No invoices yet</td></tr>
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
      <label>Address</label>
      <input className="bill-input" {...f('address')} placeholder="e.g. 152, High Level Road, Maharagama" />
      <label>Phone</label>
      <input className="bill-input" {...f('phone')} placeholder="e.g. 0777 119 126" />

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