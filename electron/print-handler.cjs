const { BrowserWindow } = require('electron');

/**
 * Generates receipt HTML and sends it to the system printer silently.
 * Works with any printer the OS has registered — thermal or otherwise.
 */
function buildReceiptHTML(invoice, shopConfig) {
  const shop = shopConfig || {};
  const fmt = (n) => parseFloat(n || 0).toFixed(2);

  const itemRows = (invoice.items || []).map((item, i) => `
    <tr>
      <td>${i + 1}) ${item.name || item.barcode}</td>
      <td class="r">${fmt(item.price)}</td>
      <td class="r">${fmt(item.discount)}</td>
      <td class="r">${fmt(item.net_price)}</td>
      <td class="r">${item.quantity}</td>
      <td class="r">${fmt(item.total)}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Courier New', monospace;
    font-size: 11px;
    width: 72mm;          /* standard 80mm roll, ~72mm print area */
    padding: 4mm 3mm;
    color: #000;
  }
  .center  { text-align: center; }
  .bold    { font-weight: bold; }
  .shop-name { font-size: 15px; font-weight: bold; }
  .divider { border-top: 1px dashed #000; margin: 4px 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 1px 2px; font-size: 10px; }
  th { text-align: left; border-bottom: 1px solid #000; }
  .r { text-align: right; }
  .summary-row td { padding: 2px 2px; }
  .summary-row.total td { font-weight: bold; font-size: 12px; border-top: 1px solid #000; }
  .barcode-area { margin-top: 6px; text-align: center; }
  .inv-no { font-size: 9px; letter-spacing: 2px; }
  @media print {
    @page { margin: 0; size: 72mm auto; }
    body { width: 72mm; }
  }
</style>
</head>
<body>
  <div class="center">
    <div class="shop-name">${shop.name || 'My Shop'}</div>
    ${shop.tagline ? `<div>${shop.tagline}</div>` : ''}
    ${shop.address ? `<div>${shop.address}</div>` : ''}
    ${shop.phone ? `<div>Tel: ${shop.phone}</div>` : ''}
  </div>
  <div class="divider"></div>
  <div>Date: ${new Date(invoice.created_at || Date.now()).toLocaleString()}</div>
  <div># ${invoice.invoice_no}</div>
  ${invoice.cashier ? `<div>Cashier: ${invoice.cashier}</div>` : ''}
  ${invoice.customer_name ? `<div>Customer: ${invoice.customer_name}${invoice.customer_phone ? '  ' + invoice.customer_phone : ''}</div>` : ''}
  <div class="divider"></div>
  <div class="center bold">Receipt - Original</div>
  <div class="divider"></div>
  <table>
    <thead>
      <tr>
        <th>#Item</th>
        <th class="r">Price</th>
        <th class="r">Save</th>
        <th class="r">Net</th>
        <th class="r">Qty</th>
        <th class="r">Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>
  <div class="divider"></div>
  <table>
    <tr class="summary-row">
      <td>Sub Total</td>
      <td class="r">${fmt(invoice.subtotal)}</td>
    </tr>
    <tr class="summary-row">
      <td>Total Discount</td>
      <td class="r">${fmt(invoice.discount)}</td>
    </tr>
    <tr class="summary-row total">
      <td>Total</td>
      <td class="r">${fmt(invoice.total)}</td>
    </tr>
    <tr class="summary-row">
      <td>Paid Cash</td>
      <td class="r">${fmt(invoice.paid_cash)}</td>
    </tr>
    <tr class="summary-row">
      <td>Balance</td>
      <td class="r">[${fmt(invoice.balance)}]</td>
    </tr>
  </table>
  ${parseFloat(invoice.balance) > 0 ? `
  <div class="divider"></div>
  <div class="bold center">Outstanding: ${fmt(invoice.balance)}</div>
  ` : ''}
  <div class="barcode-area">
    <div class="inv-no">${invoice.invoice_no}</div>
  </div>
  ${shop.footer ? `<div class="divider"></div><div class="center" style="font-size:9px">${shop.footer}</div>` : ''}
</body>
</html>`;
}

async function printReceipt(invoice, shopConfig, printerName) {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    const html = buildReceiptHTML(invoice, shopConfig);
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

    win.webContents.once('did-finish-load', () => {
      const printOptions = {
        silent: true,          // no print dialog popup
        printBackground: true,
        margins: { marginType: 'none' },
        pageSize: { width: 72000, height: 297000 }, // 72mm wide, long enough
      };

      if (printerName) printOptions.deviceName = printerName;

      win.webContents.print(printOptions, (success, err) => {
        win.destroy();
        if (success) resolve({ success: true });
        else resolve({ success: false, error: err });
      });
    });
  });
}

async function getAvailablePrinters(win) {
  return win.webContents.getPrintersAsync();
}

module.exports = { printReceipt, buildReceiptHTML, getAvailablePrinters };