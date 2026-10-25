/**
 * print.ts — QZ Tray integration & thermal receipt generation with Oshini Phone Store branding.
 */

import { OSHINI_LOGO_B64 } from './logo';

// qz-tray is a browser-only package — dynamic import guards SSR
let qz: any = null;

async function getQz() {
  if (qz) return qz;
  if (typeof window === 'undefined') {
    throw new Error('QZ Tray is only available in the browser');
  }
  const mod = await import('qz-tray');
  qz = mod.default ?? mod;
  return qz;
}

/** List available printers on the till PC via QZ Tray */
export async function listPrinters(): Promise<string[]> {
  try {
    const q = await getQz();
    if (!q.websocket.isActive()) {
      await q.websocket.connect();
    }
    return q.printers.find('');
  } catch {
    return [];
  }
}

/** Get the default printer on the till PC */
export async function getDefaultPrinter(): Promise<string> {
  const q = await getQz();
  if (!q.websocket.isActive()) {
    await q.websocket.connect();
  }
  return q.printers.getDefault();
}

/**
 * Print a receipt via QZ Tray (silent) or falls back to browser print window.
 */
export async function printReceipt(html: string, printerName?: string): Promise<void> {
  try {
    const q = await getQz();
    if (!q.websocket.isActive()) {
      await q.websocket.connect();
    }
    let targetPrinter = printerName;
    if (!targetPrinter) {
      targetPrinter = await q.printers.getDefault();
    }
    const config = q.configs.create(targetPrinter);
    await q.print(config, [{ type: 'html', format: 'plain', data: html }]);
  } catch {
    // If QZ Tray is not running locally, open printable window
    openReceiptPreview(html);
  }
}

/** Open receipt in preview/print window */
export function openReceiptPreview(htmlOrInvoice: string | any, shopConfig: any = {}): void {
  if (typeof window === 'undefined') return;
  const html = typeof htmlOrInvoice === 'string'
    ? htmlOrInvoice
    : buildReceiptHTML(htmlOrInvoice, shopConfig);

  const win = window.open('', '_blank', 'width=420,height=880,menubar=no,toolbar=no,location=no,status=no');
  if (win) {
    win.document.open();
    win.document.write(html);
    win.document.close();
  }
}

/** Disconnect from QZ Tray WebSocket */
export async function disconnectQz(): Promise<void> {
  if (!qz) return;
  if (qz.websocket.isActive()) {
    await qz.websocket.disconnect();
  }
}

function fmt(n: number | undefined | null): string {
  return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildBarcodeSvg(value: string): string {
  const code = String(value || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase() || '000000';
  let width = 0;
  const bars: string[] = [];
  const barY = 2;
  const barHeight = 38;
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
  return `<svg class="barcode-svg" viewBox="0 0 ${viewWidth} 42" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${bars.join('')}</svg>`;
}

/**
 * Builds the thermal receipt HTML with the Oshini Phone Store logo, matching the Electron POS design.
 */
export function buildReceiptHTML(invoice: any, shopConfig: any = {}): string {
  const shop = shopConfig || {};
  const isReturn = invoice?.transaction_type === 'supplier_return' || invoice?.transaction_type === 'customer_return';
  const isUsedPurchase = invoice?.transaction_type === 'used_purchase';

  const shopName = shop.shopName || shop.name || 'Oshini Phone Store';
  const shopTagline = shop.tagline || 'Smart Choice. Better Life';
  const shopAddr = shop.address || 'Colombo, Sri Lanka';
  const shopPhone = shop.phone || '+94 77 123 4567';

  const invoiceDate = invoice.created_at
    ? new Date(invoice.created_at).toLocaleString('en-GB').replace(',', '')
    : new Date().toLocaleString('en-GB').replace(',', '');

  const invoiceNo = invoice.invoice_no || '';
  const cashier = invoice.cashier || shop.cashier || '';
  const customer = invoice.customer_name || '';
  const custPhone = invoice.customer_phone || '';

  const subtotal = Number(invoice.subtotal || 0);
  const discount = Number(invoice.discount || 0);
  const total = Number(invoice.total || 0);
  const paidCash = Number(invoice.paid_cash || 0);
  const balance = Number(invoice.balance || 0);

  const itemRows = (invoice.items || []).map((item: any, i: number) => `
    <tr>
      <td class="item-name">${i + 1}) ${item.name || item.barcode || 'Item'}${item.barcode ? ' — ' + item.barcode : ''}</td>
    </tr>
    <tr>
      <td>
        <table class="item-detail-row">
          <tr>
            <td class="r">${fmt(item.price)}</td>
            ${isReturn || isUsedPurchase ? '' : `<td class="r">${fmt(item.discount || 0)}</td><td class="r">${fmt(item.net_price ?? item.price)}</td>`}
            <td class="r">${Number(item.quantity) || 1}</td>
            <td class="r">${fmt(item.total)}</td>
          </tr>
          ${item.warranty ? `<tr><td colspan="4" style="font-size:9px;color:#444">Warranty: ${item.warranty}</td></tr>` : ''}
        </table>
      </td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<title>${shopName} — ${invoiceNo}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 11px;
    font-weight: 500;
    line-height: 1.25;
    width: 72mm;
    margin: 0 auto;
    padding: 4mm 3mm 8mm 3mm;
    color: #000;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    text-rendering: geometricPrecision;
  }
  .center { text-align: center; }
  .right { text-align: right; }
  .bold { font-weight: bold; }
  .receipt-header { text-align: center; margin-bottom: 4px; }
  .shop-name { font-size: 13px; font-weight: 800; letter-spacing: 0.2px; text-transform: uppercase; }
  .logo-wrap { text-align: center; margin: 4px 0; }
  .logo-wrap img { width: 34mm; max-height: 20mm; object-fit: contain; }
  .shop-tagline { font-size: 8.5px; text-align: center; letter-spacing: 0.6px; color: #333; margin-top: 1px; }
  .shop-address { font-size: 9px; text-align: center; line-height: 1.3; }
  .shop-phone { font-size: 9px; text-align: center; line-height: 1.3; }
  .divider-solid { border-top: 1px solid #000; margin: 3px 0; }
  .divider { border-top: 1px dashed #000; margin: 3px 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 1px 2px; font-size: 10.5px; }
  th { font-weight: 700; }
  .header-row th { border-bottom: 1px solid #000; font-size: 10px; }
  .r { text-align: right; }
  .item-name { font-size: 10.5px; padding-top: 3px; font-weight: 600; }
  .item-detail-row { width: 100%; }
  .item-detail-row td { font-size: 10px; padding: 0 2px; }
  .summary-table td { padding: 1.5px 2px; font-size: 10.5px; }
  .summary-table .total-row td { font-weight: 800; font-size: 12px; }
  .balance-card { margin-top: 4px; padding: 4px 0 3px; text-align: center; border-top: 1px solid #000; border-bottom: 1px solid #000; }
  .balance-card.due { background: #f4f4f4; }
  .balance-label { font-size: 8.5px; letter-spacing: 0.5px; text-transform: uppercase; }
  .balance-value { font-size: 15px; font-weight: 800; line-height: 1.1; }
  .barcode-area { margin-top: 5px; text-align: center; }
  .barcode-svg { width: 100%; height: 50px; display: block; }
  .barcode-text { font-size: 8.5px; letter-spacing: 1px; margin-top: 2px; font-family: monospace; }
  .footer-text { font-size: 8.5px; text-align: center; margin-top: 3px; line-height: 1.35; }
  .print-btn-bar { text-align: center; margin-bottom: 10px; }
  .print-btn {
    background: #4f46e5; color: #fff; border: none; padding: 6px 16px;
    font-size: 12px; font-weight: bold; border-radius: 6px; cursor: pointer;
  }
  @media print {
    @page { margin: 0; size: 72mm auto; }
    body { width: 72mm; padding: 2mm 2mm; }
    .print-btn-bar { display: none !important; }
  }
</style>
</head>
<body>

  <div class="print-btn-bar">
    <button class="print-btn" onclick="window.print()">🖨️ Print Receipt</button>
  </div>

  <div class="receipt-header">
    <div class="shop-name">${shopName}</div>
    <div class="shop-tagline">${shopTagline}</div>
    ${shopAddr ? `<div class="shop-address">${shopAddr}</div>` : ''}
    ${shopPhone ? `<div class="shop-phone">Tel: ${shopPhone}</div>` : ''}
  </div>

  <div class="logo-wrap">
    <img src="data:image/jpeg;base64,${OSHINI_LOGO_B64}" alt="${shopName}" />
  </div>

  <div style="font-size:9.5px; text-align:center; margin-top:2px; font-weight:500;">
    Date: ${invoiceDate}
  </div>
  <div style="font-size:10px; text-align:center; font-weight:700; font-family:monospace;">
    # ${invoiceNo}
  </div>
  ${cashier ? `<div style="font-size:9.5px; text-align:center; font-weight:500;">Cashier: ${cashier}</div>` : ''}
  ${customer ? `<div style="font-size:9.5px; text-align:center; font-weight:500;">Customer: ${customer}${custPhone ? ' (' + custPhone + ')' : ''}</div>` : ''}

  <div class="divider"></div>
  <div class="center bold" style="font-size:10.5px; text-transform:uppercase;">
    ${isUsedPurchase ? 'Used Purchase Receipt' : isReturn ? 'Return Voucher' : 'Sales Receipt'}
  </div>
  <div class="divider"></div>

  <table>
    <thead>
      <tr class="header-row">
        <th style="text-align:left;">Item</th>
      </tr>
      <tr>
        <th>
          <div style="display:flex; justify-content:space-between; font-size:9px; color:#333;">
            <span>Price</span>
            ${isReturn || isUsedPurchase ? '' : '<span>Disc</span><span>Net</span>'}
            <span>Qty</span>
            <span>Total</span>
          </div>
        </th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>

  <div class="divider-solid"></div>

  <table class="summary-table">
    <tr>
      <td>Subtotal:</td>
      <td class="r">Rs. ${fmt(subtotal)}</td>
    </tr>
    ${discount > 0 ? `
    <tr>
      <td>Discount:</td>
      <td class="r">-Rs. ${fmt(discount)}</td>
    </tr>` : ''}
    <tr class="total-row">
      <td>NET TOTAL:</td>
      <td class="r">Rs. ${fmt(total)}</td>
    </tr>
    <tr>
      <td>Cash Paid:</td>
      <td class="r">Rs. ${fmt(paidCash)}</td>
    </tr>
  </table>

  <div class="balance-card ${balance > 0 ? 'due' : ''}">
    <div class="balance-label">${balance > 0 ? 'Balance Due' : 'Change / Settled'}</div>
    <div class="balance-value">Rs. ${fmt(Math.abs(balance))}</div>
  </div>

  <div class="barcode-area">
    ${buildBarcodeSvg(invoiceNo)}
    <div class="barcode-text">* ${invoiceNo} *</div>
  </div>

  <div class="divider"></div>
  <div class="footer-text">
    Thank you for shopping with ${shopName}!<br/>
    Quality Phones, Accessories &amp; Expert Repairs
  </div>
</body>
</html>`;
}
