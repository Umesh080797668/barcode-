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

    if (!product.barcode) {
      product.barcode = this.generateBarcodeNumber();
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
    
    // total
    let totalProducts = 0;
    let res = this.db.exec('SELECT COUNT(*) as c FROM products');
    if (res.length > 0 && res[0].values[0][0]) totalProducts = res[0].values[0][0];

    // value
    let totalValue = 0;
    let res2 = this.db.exec('SELECT SUM(price * quantity) as v FROM products');
    if (res2.length > 0 && res2[0].values[0][0]) totalValue = res2[0].values[0][0];

    return { totalProducts, totalValue, recentlyAdded: 0 };
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
}

module.exports = BarcodeDB;
