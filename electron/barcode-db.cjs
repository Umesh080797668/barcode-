const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

function getDbPath(app) {
  const base = app && app.isPackaged
    ? app.getPath('userData')
    : path.join(__dirname, '..');
  return path.join(base, 'scanvault-products.sqlite');
}

class BarcodeDB {
  constructor(app) {
    this.app = app;
    this.dbPath = getDbPath(app);
    this.db = null;
    this.isReady = false;
    this.initPromise = this._init();
  }

  async _init() {
    try {
      const SQL = await initSqlJs();
      if (fs.existsSync(this.dbPath)) {
        const fileBuffer = fs.readFileSync(this.dbPath);
        this.db = new SQL.Database(fileBuffer);
      } else {
        this.db = new SQL.Database();
      }

      this.db.run(`
        CREATE TABLE IF NOT EXISTS products (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          barcode       TEXT    NOT NULL UNIQUE,
          name          TEXT,
          sku           TEXT,
          price         REAL,
          quantity      INTEGER DEFAULT 0,
          category      TEXT,
          created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at    TEXT DEFAULT CURRENT_TIMESTAMP,
          custom_fields TEXT
        );
      `);

      this.db.run(`
        CREATE TABLE IF NOT EXISTS custom_fields (
          id           TEXT PRIMARY KEY,
          label        TEXT NOT NULL,
          field_type   TEXT NOT NULL DEFAULT 'text',
          default_val  TEXT DEFAULT '',
          sort_order   INTEGER DEFAULT 0
        );
      `);
      
      this._saveDisk();
      this.isReady = true;
    } catch (err) {
      console.error('[BarcodeDB] sql.js init error:', err);
    }
  }

  _saveDisk() {
    if (!this.db) return;
    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(this.dbPath, buffer);
  }

  async _ensureReady() {
    if (!this.isReady) await this.initPromise;
  }

  // ── barcode number generation ────────────────────────────────────────────
  generateBarcodeNumber() {
    const prefix = 'SV';
    const now    = Date.now().toString().slice(-8);
    let rand = Math.floor(Math.random() * 100).toString().padStart(2, '0');
    return `${prefix}${now}${rand}`;
  }

  async getProducts(opts = {}) {
    await this._ensureReady();
    if (!this.db) return [];

    let query = 'SELECT * FROM products';
    const stmt = this.db.prepare(query);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();

    return results.map(row => ({
      ...row,
      custom_fields: row.custom_fields ? JSON.parse(row.custom_fields) : {}
    }));
  }

  async getProduct(barcode) {
    await this._ensureReady();
    if (!this.db) return null;

    const stmt = this.db.prepare('SELECT * FROM products WHERE barcode = ?');
    stmt.bind([barcode]);
    let result = null;
    if (stmt.step()) {
      result = stmt.getAsObject();
    }
    stmt.free();

    if (!result) return null;
    return {
      ...result,
      custom_fields: result.custom_fields ? JSON.parse(result.custom_fields) : {}
    };
  }

  async saveProduct(product) {
    await this._ensureReady();
    if (!this.db) throw new Error('Database not initialized');

    // Validate required fields
    if (!product.barcode) {
      return { success: false, error: 'Barcode is required' };
    }
    if (!product.name || String(product.name).trim() === '') {
      return { success: false, error: 'Product name is required' };
    }
    if (product.quantity === undefined || product.quantity === null) {
      return { success: false, error: 'Quantity is required' };
    }
    if (product.price === undefined || product.price === null) {
      return { success: false, error: 'Price is required' };
    }

    const customFieldsStr = product.custom_fields ? JSON.stringify(product.custom_fields) : '{}';

    const existing = await this.getProduct(product.barcode);
    if (existing) {
      const stmt = this.db.prepare(`
        UPDATE products 
        SET name = ?, sku = ?, price = ?, quantity = ?, category = ?, custom_fields = ?, updated_at = CURRENT_TIMESTAMP
        WHERE barcode = ?
      `);
      stmt.run([
        product.name || null,
        product.sku || null,
        product.price || 0,
        product.quantity || 0,
        product.category || null,
        customFieldsStr,
        product.barcode
      ]);
      stmt.free();
    } else {
      const stmt = this.db.prepare(`
        INSERT INTO products (barcode, name, sku, price, quantity, category, custom_fields)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run([
        product.barcode,
        product.name || null,
        product.sku || null,
        product.price || 0,
        product.quantity || 0,
        product.category || null,
        customFieldsStr
      ]);
      stmt.free();
    }

    this._saveDisk();
    return { success: true, barcode: product.barcode };
  }

  async deleteProduct(idOrBarcode) {
    await this._ensureReady();
    if (!this.db) return { success: false };

    const stmt = this.db.prepare('DELETE FROM products WHERE id = ? OR barcode = ?');
    stmt.run([idOrBarcode, idOrBarcode]);
    stmt.free();
    
    this._saveDisk();
    return { success: true };
  }

  async getStats() {
    await this._ensureReady();
    if (!this.db) return { totalProducts: 0, totalValue: 0, recentlyAdded: 0 };
    // total products
    let totalProducts = 0;
    let res = this.db.exec('SELECT COUNT(*) as c FROM products');
    if (res.length > 0 && res[0].values[0][0]) totalProducts = res[0].values[0][0];

    // total quantity
    let totalQty = 0;
    let resQty = this.db.exec('SELECT SUM(quantity) as q FROM products');
    if (resQty.length > 0 && resQty[0].values[0][0]) totalQty = resQty[0].values[0][0];

    // total value
    let totalValue = 0;
    let res2 = this.db.exec('SELECT SUM(price * quantity) as v FROM products');
    if (res2.length > 0 && res2[0].values[0][0]) totalValue = res2[0].values[0][0];

    return { total: totalProducts, totalQty, totalValue, recentlyAdded: 0 };
  }

  async getCustomFields() {
    await this._ensureReady();
    if (!this.db) return [];

    const stmt = this.db.prepare('SELECT * FROM custom_fields ORDER BY sort_order ASC');
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  async saveCustomField(field) {
    await this._ensureReady();
    if (!this.db) throw new Error('Database not initialized');
    
    if (!field.id) field.id = 'field_' + Date.now();
    
    const stmt = this.db.prepare('SELECT id FROM custom_fields WHERE id = ?');
    stmt.bind([field.id]);
    const exists = stmt.step();
    stmt.free();

    if (exists) {
      const u = this.db.prepare(`
        UPDATE custom_fields 
        SET label = ?, field_type = ?, default_val = ?, sort_order = ?
        WHERE id = ?
      `);
      u.run([field.label, field.field_type || 'text', field.default_val || '', field.sort_order || 0, field.id]);
      u.free();
    } else {
      const i = this.db.prepare(`
        INSERT INTO custom_fields (id, label, field_type, default_val, sort_order)
        VALUES (?, ?, ?, ?, ?)
      `);
      i.run([field.id, field.label, field.field_type || 'text', field.default_val || '', field.sort_order || 0]);
      i.free();
    }
    
    this._saveDisk();
    return { success: true, id: field.id };
  }

  async deleteCustomField(id) {
    await this._ensureReady();
    if (!this.db) return { success: false };
    const stmt = this.db.prepare('DELETE FROM custom_fields WHERE id = ?');
    stmt.run([id]);
    stmt.free();
    this._saveDisk();
    return { success: true };
  }

  // ── INVOICES ─────────────────────────────────────────────────────────────────

async _ensureInvoiceTables() {
  await this._ensureReady();
  this.db.run(`
    CREATE TABLE IF NOT EXISTS invoices (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_no    TEXT NOT NULL UNIQUE,
      customer_name TEXT,
      customer_phone TEXT,
      cashier       TEXT,
      subtotal      REAL DEFAULT 0,
      discount      REAL DEFAULT 0,
      total         REAL DEFAULT 0,
      paid_cash     REAL DEFAULT 0,
      balance       REAL DEFAULT 0,
      status        TEXT DEFAULT 'unpaid',
      created_at    TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  this.db.run(`
    CREATE TABLE IF NOT EXISTS invoice_items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id  INTEGER NOT NULL,
      barcode     TEXT,
      name        TEXT,
      price       REAL DEFAULT 0,
      quantity    INTEGER DEFAULT 1,
      discount    REAL DEFAULT 0,
      net_price   REAL DEFAULT 0,
      total       REAL DEFAULT 0,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    );
  `);
  this._saveDisk();
}

generateInvoiceNumber() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(Math.random() * 99999).toString().padStart(5, '0');
  return `INV-${y}-${m}${d}-${rand}`;
}

async saveInvoice(invoice) {
  await this._ensureInvoiceTables();
  const invNo = invoice.invoice_no || this.generateInvoiceNumber();

  const stmt = this.db.prepare(`
    INSERT INTO invoices 
      (invoice_no, customer_name, customer_phone, cashier, subtotal, discount, total, paid_cash, balance, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run([
    invNo,
    invoice.customer_name || '',
    invoice.customer_phone || '',
    invoice.cashier || '',
    invoice.subtotal || 0,
    invoice.discount || 0,
    invoice.total || 0,
    invoice.paid_cash || 0,
    invoice.balance || 0,
    invoice.status || 'unpaid'
  ]);
  stmt.free();

  // Get the new invoice id
  const idRes = this.db.exec("SELECT last_insert_rowid() as id");
  const invoiceId = idRes[0].values[0][0];

  // Insert items
  for (const item of (invoice.items || [])) {
    const iStmt = this.db.prepare(`
      INSERT INTO invoice_items (invoice_id, barcode, name, price, quantity, discount, net_price, total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    iStmt.run([
      invoiceId,
      item.barcode || '',
      item.name || '',
      item.price || 0,
      item.quantity || 1,
      item.discount || 0,
      item.net_price || item.price || 0,
      item.total || 0
    ]);
    iStmt.free();

    // Reduce stock quantity
    if (item.barcode) {
      const uStmt = this.db.prepare(`
        UPDATE products SET quantity = MAX(0, quantity - ?) WHERE barcode = ?
      `);
      uStmt.run([item.quantity || 1, item.barcode]);
      uStmt.free();
    }
  }

  this._saveDisk();
  return { success: true, invoice_no: invNo, id: invoiceId };
}

async getInvoices(limit = 50) {
  await this._ensureInvoiceTables();
  const stmt = this.db.prepare(
    'SELECT * FROM invoices ORDER BY created_at DESC LIMIT ?'
  );
  stmt.bind([limit]);
  const results = [];
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}

async getInvoice(invoiceNo) {
  await this._ensureInvoiceTables();
  const stmt = this.db.prepare('SELECT * FROM invoices WHERE invoice_no = ?');
  stmt.bind([invoiceNo]);
  let inv = null;
  if (stmt.step()) inv = stmt.getAsObject();
  stmt.free();
  if (!inv) return null;

  const iStmt = this.db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?');
  iStmt.bind([inv.id]);
  const items = [];
  while (iStmt.step()) items.push(iStmt.getAsObject());
  iStmt.free();

  return { ...inv, items };
}

async deleteInvoice(invoiceNo) {
  await this._ensureInvoiceTables();
  const inv = await this.getInvoice(invoiceNo);
  if (!inv) return { success: false };
  this.db.run('DELETE FROM invoice_items WHERE invoice_id = ?', [inv.id]);
  this.db.run('DELETE FROM invoices WHERE invoice_no = ?', [invoiceNo]);
  this._saveDisk();
  return { success: true };
}
}

module.exports = BarcodeDB;
