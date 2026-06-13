const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

function getDbPath(app) {
  const base = app && app.isPackaged
    ? app.getPath('userData')
    : path.join(__dirname, '..');
  return path.join(base, 'scanvault-products.sqlite');
}

function getLegacyDbPaths(app) {
  const paths = [
    path.join(__dirname, '..', 'scanvault-products.sqlite'),
  ];

  if (app?.getAppPath) {
    paths.unshift(path.join(app.getAppPath(), 'scanvault-products.sqlite'));
  }

  return [...new Set(paths)];
}

class BarcodeDB {
  constructor(app) {
    this.app = app;
    this.dbPath = getDbPath(app);
    this.db = null;
    this.isReady = false;
    this.saveTimer = null;
    this.initPromise = this._init();
  }

  async _init() {
    try {
      const SQL = await initSqlJs();
      const legacyPaths = getLegacyDbPaths(this.app).filter((candidate) => candidate !== this.dbPath);
      const hadDbFile = fs.existsSync(this.dbPath);
      if (!hadDbFile) {
        const legacyPath = legacyPaths.find((candidate) => fs.existsSync(candidate));
        if (legacyPath) {
          fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
          fs.copyFileSync(legacyPath, this.dbPath);
        }
      }

      if (fs.existsSync(this.dbPath)) {
        const fileBuffer = fs.readFileSync(this.dbPath);
        this.db = new SQL.Database(fileBuffer);
      } else {
        this.db = new SQL.Database();
      }

      this.db.run('PRAGMA foreign_keys = ON');

      let schemaChanged = false;
      this.db.run(`
          CREATE TABLE IF NOT EXISTS products (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            barcode       TEXT    NOT NULL UNIQUE,
            name          TEXT,
            sku           TEXT,
            price         REAL,
            quantity      INTEGER DEFAULT 0,
            scan_mode     TEXT DEFAULT 'normal',
            category      TEXT,
            created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at    TEXT DEFAULT CURRENT_TIMESTAMP,
            custom_fields TEXT
          );
        `);

      const productColumns = this.db.exec(`PRAGMA table_info(products)`);
      const hasScanMode = productColumns?.[0]?.values?.some((row) => row[1] === 'scan_mode');
      if (!hasScanMode) {
        this.db.run(`ALTER TABLE products ADD COLUMN scan_mode TEXT DEFAULT 'normal'`);
        schemaChanged = true;
      }

      const hasModal = productColumns?.[0]?.values?.some((row) => row[1] === 'modal');
      if (!hasModal) {
        this.db.run(`ALTER TABLE products ADD COLUMN modal TEXT`);
        schemaChanged = true;
      }

      this.db.run(`CREATE INDEX IF NOT EXISTS idx_products_scan_mode ON products(scan_mode)`);
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_products_category ON products(category)`);

      this.db.run(`
          CREATE TABLE IF NOT EXISTS custom_fields (
            id           TEXT PRIMARY KEY,
            label        TEXT NOT NULL,
            field_type   TEXT NOT NULL DEFAULT 'text',
            default_val  TEXT DEFAULT '',
            sort_order   INTEGER DEFAULT 0
          );
        `);
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_custom_fields_sort_order ON custom_fields(sort_order)`);

      if (!hadDbFile || schemaChanged) {
        this._saveDisk();
      }
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

  _scheduleSaveDisk() {
    if (!this.db) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this._saveDisk();
    }, 250);
  }

  flushNow() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this._saveDisk();
  }

  async _ensureReady() {
    if (!this.isReady) await this.initPromise;
  }

  // ── barcode number generation ────────────────────────────────────────────
  generateBarcodeNumber() {
    const prefix = 'SV';
    const now = Date.now().toString().slice(-8);
    let rand = Math.floor(Math.random() * 100).toString().padStart(2, '0');
    return `${prefix}${now}${rand}`;
  }

  async getProducts(opts = {}) {
    await this._ensureReady();
    if (!this.db) return [];

    const conditions = [];
    const params = [];
    const search = String(opts?.search || '').trim().toLowerCase();

    if (opts?.billingOnly) {
      conditions.push("scan_mode <> 'inventory_only'");
    }

    if (search) {
      conditions.push(`(
          LOWER(COALESCE(barcode, '')) LIKE ? OR
          LOWER(COALESCE(name, '')) LIKE ? OR
          LOWER(COALESCE(sku, '')) LIKE ? OR
          LOWER(COALESCE(category, '')) LIKE ? OR
          LOWER(COALESCE(scan_mode, '')) LIKE ? OR
          LOWER(COALESCE(custom_fields, '')) LIKE ? OR
          CAST(price AS TEXT) LIKE ? OR
          CAST(quantity AS TEXT) LIKE ?
        )`);
      const needle = `%${search}%`;
      params.push(needle, needle, needle, needle, needle, needle, needle, needle);
    }

    let query = 'SELECT * FROM products';
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    query += ' ORDER BY id ASC';
    if (Number.isFinite(opts?.limit)) {
      query += ' LIMIT ?';
      params.push(Number(opts.limit));
    }
    if (Number.isFinite(opts?.offset)) {
      query += ' OFFSET ?';
      params.push(Number(opts.offset));
    }

    const stmt = this.db.prepare(query);
    if (params.length > 0) stmt.bind(params);
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
    const scanMode = product.scan_mode || 'normal';

    const existing = await this.getProduct(product.barcode);
    if (existing) {
      const stmt = this.db.prepare(`
          UPDATE products 
          SET name = ?, sku = ?, price = ?, quantity = ?, scan_mode = ?, category = ?, modal = ?, custom_fields = ?, updated_at = CURRENT_TIMESTAMP
          WHERE barcode = ?
        `);
      stmt.run([
        product.name || null,
        product.sku || null,
        product.price || 0,
        product.quantity || 0,
        scanMode,
        product.category || null,
        product.modal || null,
        customFieldsStr,
        product.barcode
      ]);
      stmt.free();
    } else {
      const stmt = this.db.prepare(`
          INSERT INTO products (barcode, name, sku, price, quantity, scan_mode, category, modal, custom_fields)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
      stmt.run([
        product.barcode,
        product.name || null,
        product.sku || null,
        product.price || 0,
        product.quantity || 0,
        scanMode,
        product.category || null,
        product.modal || null,
        customFieldsStr
      ]);
      stmt.free();
    }

    this._scheduleSaveDisk();
    return { success: true, barcode: product.barcode };
  }

  async syncProductRecord(product) {
    await this._ensureReady();
    if (!this.db) throw new Error('Database not initialized');
    if (!product?.barcode) {
      return { success: false, error: 'Barcode is required' };
    }

    const existing = await this.getProduct(product.barcode);
    const merged = {
      barcode: product.barcode,
      name: product.name ?? existing?.name ?? null,
      sku: product.sku ?? existing?.sku ?? null,
      price: product.price ?? existing?.price ?? 0,
      quantity: product.quantity ?? existing?.quantity ?? 0,
      scan_mode: product.scan_mode ?? existing?.scan_mode ?? 'normal',
      category: product.category ?? existing?.category ?? null,
      modal: product.modal ?? existing?.modal ?? null,
      custom_fields: product.custom_fields ?? existing?.custom_fields ?? {},
    };

    const customFieldsStr = merged.custom_fields ? JSON.stringify(merged.custom_fields) : '{}';
    if (existing) {
      const stmt = this.db.prepare(`
          UPDATE products
          SET name = ?, sku = ?, price = ?, quantity = ?, scan_mode = ?, category = ?, modal = ?, custom_fields = ?, updated_at = CURRENT_TIMESTAMP
          WHERE barcode = ?
        `);
      stmt.run([
        merged.name,
        merged.sku,
        merged.price || 0,
        merged.quantity || 0,
        merged.scan_mode,
        merged.category,
        merged.modal,
        customFieldsStr,
        merged.barcode,
      ]);
      stmt.free();
    } else {
      const stmt = this.db.prepare(`
          INSERT INTO products (barcode, name, sku, price, quantity, scan_mode, category, modal, custom_fields)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
      stmt.run([
        merged.barcode,
        merged.name,
        merged.sku,
        merged.price || 0,
        merged.quantity || 0,
        merged.scan_mode,
        merged.category,
        merged.modal,
        customFieldsStr,
      ]);
      stmt.free();
    }

    this._scheduleSaveDisk();
    return { success: true, barcode: merged.barcode };
  }

  async deleteProduct(idOrBarcode) {
    await this._ensureReady();
    if (!this.db) return { success: false };

    const stmt = this.db.prepare('DELETE FROM products WHERE id = ? OR barcode = ?');
    stmt.run([idOrBarcode, idOrBarcode]);
    stmt.free();

    this._scheduleSaveDisk();
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

    this._scheduleSaveDisk();
    return { success: true, id: field.id };
  }

  async deleteCustomField(id) {
    await this._ensureReady();
    if (!this.db) return { success: false };
    const stmt = this.db.prepare('DELETE FROM custom_fields WHERE id = ?');
    stmt.run([id]);
    stmt.free();
    this._scheduleSaveDisk();
    return { success: true };
  }

  async exportBackupSnapshot() {
    await this._ensureInvoiceTables();
    if (!this.db) throw new Error('Database not initialized');

    const readRows = (sql) => {
      const stmt = this.db.prepare(sql);
      const results = [];
      while (stmt.step()) results.push(stmt.getAsObject());
      stmt.free();
      return results;
    };

    const products = readRows(`
        SELECT barcode, name, sku, price, quantity, scan_mode, category, modal, created_at, updated_at, custom_fields
        FROM products
        ORDER BY id ASC
      `).map((row) => ({
      ...row,
      custom_fields_json: row.custom_fields || '{}',
    }));

    const customFields = readRows(`
        SELECT id, label, field_type, default_val, sort_order
        FROM custom_fields
        ORDER BY sort_order ASC, id ASC
      `);

    const invoices = readRows(`
        SELECT id, invoice_no, customer_name, customer_phone, cashier, subtotal, discount, total, paid_cash, balance, status, transaction_type, return_reason, created_at
        FROM invoices
        ORDER BY created_at ASC, id ASC
      `);

    const invoiceItems = readRows(`
        SELECT i.invoice_no, ii.barcode, ii.name, ii.price, ii.quantity, ii.discount, ii.net_price, ii.total, ii.warranty, ii.remaining_warranty
        FROM invoice_items ii
        INNER JOIN invoices i ON ii.invoice_id = i.id
        ORDER BY i.created_at ASC, ii.id ASC
      `);

    return { products, customFields, invoices, invoiceItems };
  }

  async restoreBackupSnapshot(snapshot = {}) {
    await this._ensureInvoiceTables();
    if (!this.db) throw new Error('Database not initialized');

    const isBlankValue = (value) => value === null || value === undefined || value === '';
    const products = Array.isArray(snapshot.products) ? snapshot.products : [];
    const customFields = Array.isArray(snapshot.customFields)
      ? snapshot.customFields
      : Array.isArray(snapshot.custom_fields)
        ? snapshot.custom_fields
        : [];
    const invoices = Array.isArray(snapshot.invoices) ? snapshot.invoices : [];
    const invoiceItems = Array.isArray(snapshot.invoiceItems)
      ? snapshot.invoiceItems
      : Array.isArray(snapshot.invoice_items)
        ? snapshot.invoice_items
        : [];

    const parseCustomFields = (value) => {
      if (value === null || value === undefined || value === '') return {};
      if (typeof value === 'object' && !Array.isArray(value)) return value;
      try { return JSON.parse(String(value)); } catch (_) { return {}; }
    };

    const serializeCustomFields = (value) => JSON.stringify(parseCustomFields(value));

    const readRows = (sql) => {
      const stmt = this.db.prepare(sql);
      const results = [];
      while (stmt.step()) results.push(stmt.getAsObject());
      stmt.free();
      return results;
    };

    const mergeMissingValues = (existingRow, incomingRow, fields) => {
      const next = { ...existingRow };
      let changed = false;
      for (const field of fields) {
        if (isBlankValue(next[field]) && !isBlankValue(incomingRow[field])) {
          next[field] = incomingRow[field];
          changed = true;
        }
      }
      return { next, changed };
    };

    const rowSignature = (row) => [
      String(row.invoice_no || '').trim(),
      String(row.barcode || '').trim(),
      String(row.name || '').trim(),
      String(row.price ?? '').trim(),
      String(row.quantity ?? '').trim(),
      String(row.discount ?? '').trim(),
      String(row.net_price ?? '').trim(),
      String(row.total ?? '').trim(),
      String(row.warranty || '').trim(),
      String(row.remaining_warranty || '').trim(),
    ].join('|');

    const existingProducts = new Map(readRows('SELECT * FROM products').map((row) => [String(row.barcode || ''), row]));
    const existingCustomFields = new Map(readRows('SELECT * FROM custom_fields').map((row) => [String(row.id || ''), row]));
    const existingInvoices = new Map(readRows('SELECT * FROM invoices').map((row) => [String(row.invoice_no || ''), row]));
    const existingInvoiceItems = readRows(`
        SELECT ii.id as item_id, i.invoice_no, ii.barcode, ii.name, ii.price, ii.quantity, ii.discount, ii.net_price, ii.total, ii.warranty, ii.remaining_warranty
        FROM invoice_items ii
        INNER JOIN invoices i ON ii.invoice_id = i.id
        ORDER BY i.id ASC, ii.id ASC
      `);

    const itemsByInvoiceNo = new Map();
    for (const item of existingInvoiceItems) {
      const invoiceNo = String(item.invoice_no || '').trim();
      if (!invoiceNo) continue;
      if (!itemsByInvoiceNo.has(invoiceNo)) itemsByInvoiceNo.set(invoiceNo, []);
      itemsByInvoiceNo.get(invoiceNo).push(item);
    }

    this.db.run('BEGIN TRANSACTION');
    try {
      let productsInserted = 0;
      let productsUpdated = 0;
      let customFieldsInserted = 0;
      let customFieldsUpdated = 0;
      let invoicesInserted = 0;
      let invoicesUpdated = 0;
      let invoiceItemsInserted = 0;
      let invoiceItemsUpdated = 0;

      for (const product of products) {
        const barcode = String(product.barcode || '').trim();
        if (!barcode) continue;

        const incomingProduct = {
          barcode,
          name: product.name ?? null,
          sku: product.sku ?? null,
          price: Number(product.price) || 0,
          quantity: Number(product.quantity) || 0,
          scan_mode: product.scan_mode || 'normal',
          category: product.category ?? null,
          modal: product.modal ?? null,
          custom_fields: serializeCustomFields(product.custom_fields_json ?? product.custom_fields),
        };

        const existing = existingProducts.get(barcode);
        if (existing) {
          const merged = mergeMissingValues(existing, incomingProduct, ['name', 'sku', 'price', 'quantity', 'scan_mode', 'category', 'modal', 'custom_fields']);
          if (merged.changed) {
            const stmt = this.db.prepare(`
                UPDATE products
                SET name = ?, sku = ?, price = ?, quantity = ?, scan_mode = ?, category = ?, modal = ?, custom_fields = ?, updated_at = CURRENT_TIMESTAMP
                WHERE barcode = ?
              `);
            stmt.run([
              merged.next.name,
              merged.next.sku,
              merged.next.price || 0,
              merged.next.quantity || 0,
              merged.next.scan_mode,
              merged.next.category,
              merged.next.modal,
              merged.next.custom_fields,
              barcode,
            ]);
            stmt.free();
            existingProducts.set(barcode, { ...existing, ...merged.next });
            productsUpdated += 1;
          }
        } else {
          const stmt = this.db.prepare(`
              INSERT INTO products (barcode, name, sku, price, quantity, scan_mode, category, modal, custom_fields)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
          stmt.run([
            incomingProduct.barcode,
            incomingProduct.name,
            incomingProduct.sku,
            incomingProduct.price,
            incomingProduct.quantity,
            incomingProduct.scan_mode,
            incomingProduct.category,
            incomingProduct.modal,
            incomingProduct.custom_fields,
          ]);
          stmt.free();
          existingProducts.set(barcode, incomingProduct);
          productsInserted += 1;
        }
      }

      for (const field of customFields) {
        if (!field?.id) continue;
        const fieldId = String(field.id);
        const incomingField = {
          id: fieldId,
          label: field.label || '',
          field_type: field.field_type || 'text',
          default_val: field.default_val || '',
          sort_order: Number(field.sort_order) || 0,
        };

        const existing = existingCustomFields.get(fieldId);
        if (existing) {
          const merged = mergeMissingValues(existing, incomingField, ['label', 'field_type', 'default_val', 'sort_order']);
          if (merged.changed) {
            const stmt = this.db.prepare(`
                UPDATE custom_fields
                SET label = ?, field_type = ?, default_val = ?, sort_order = ?
                WHERE id = ?
              `);
            stmt.run([
              merged.next.label,
              merged.next.field_type,
              merged.next.default_val,
              merged.next.sort_order,
              fieldId,
            ]);
            stmt.free();
            existingCustomFields.set(fieldId, { ...existing, ...merged.next });
            customFieldsUpdated += 1;
          }
        } else {
          const stmt = this.db.prepare(`
              INSERT INTO custom_fields (id, label, field_type, default_val, sort_order)
              VALUES (?, ?, ?, ?, ?)
            `);
          stmt.run([
            incomingField.id,
            incomingField.label,
            incomingField.field_type,
            incomingField.default_val,
            incomingField.sort_order,
          ]);
          stmt.free();
          existingCustomFields.set(fieldId, incomingField);
          customFieldsInserted += 1;
        }
      }

      for (const invoice of invoices) {
        const invoiceNo = String(invoice.invoice_no || '').trim();
        if (!invoiceNo) continue;

        const incomingInvoice = {
          invoice_no: invoiceNo,
          customer_name: invoice.customer_name || '',
          customer_phone: invoice.customer_phone || '',
          cashier: invoice.cashier || '',
          subtotal: Number(invoice.subtotal) || 0,
          discount: Number(invoice.discount) || 0,
          total: Number(invoice.total) || 0,
          paid_cash: Number(invoice.paid_cash) || 0,
          balance: Number(invoice.balance) || 0,
          status: invoice.status || 'unpaid',
          transaction_type: invoice.transaction_type || 'sale',
          return_reason: invoice.return_reason || '',
          created_at: invoice.created_at || new Date().toISOString(),
        };

        const existingInvoice = existingInvoices.get(invoiceNo);
        let invoiceId = existingInvoice?.id || null;
        if (existingInvoice) {
          const merged = mergeMissingValues(existingInvoice, incomingInvoice, [
            'customer_name', 'customer_phone', 'cashier', 'subtotal', 'discount', 'total', 'paid_cash', 'balance', 'status', 'transaction_type', 'return_reason', 'created_at',
          ]);
          if (merged.changed) {
            const stmt = this.db.prepare(`
                UPDATE invoices
                SET customer_name = ?, customer_phone = ?, cashier = ?, subtotal = ?, discount = ?, total = ?, paid_cash = ?, balance = ?, status = ?, transaction_type = ?, return_reason = ?, created_at = ?
                WHERE invoice_no = ?
              `);
            stmt.run([
              merged.next.customer_name,
              merged.next.customer_phone,
              merged.next.cashier,
              merged.next.subtotal,
              merged.next.discount,
              merged.next.total,
              merged.next.paid_cash,
              merged.next.balance,
              merged.next.status,
              merged.next.transaction_type,
              merged.next.return_reason,
              merged.next.created_at,
              invoiceNo,
            ]);
            stmt.free();
            existingInvoices.set(invoiceNo, { ...existingInvoice, ...merged.next });
            invoicesUpdated += 1;
          }
        } else {
          const stmt = this.db.prepare(`
              INSERT INTO invoices (
                invoice_no, customer_name, customer_phone, cashier, subtotal, discount, total, paid_cash, balance, status, transaction_type, return_reason, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
          stmt.run([
            incomingInvoice.invoice_no,
            incomingInvoice.customer_name,
            incomingInvoice.customer_phone,
            incomingInvoice.cashier,
            incomingInvoice.subtotal,
            incomingInvoice.discount,
            incomingInvoice.total,
            incomingInvoice.paid_cash,
            incomingInvoice.balance,
            incomingInvoice.status,
            incomingInvoice.transaction_type,
            incomingInvoice.return_reason,
            incomingInvoice.created_at,
          ]);
          stmt.free();
          const idRes = this.db.exec('SELECT last_insert_rowid() as id');
          invoiceId = idRes?.[0]?.values?.[0]?.[0] || null;
          existingInvoices.set(invoiceNo, { ...incomingInvoice, id: invoiceId });
          invoicesInserted += 1;
        }

        const currentItems = itemsByInvoiceNo.get(invoiceNo) || [];
        const currentItemMap = new Map(currentItems.map((item) => [rowSignature(item), item]));
        const incomingItems = invoiceItems.filter((item) => String(item.invoice_no || '').trim() === invoiceNo);

        for (const item of incomingItems) {
          const normalizedIncomingItem = {
            invoice_no: invoiceNo,
            barcode: item.barcode || '',
            name: item.name || '',
            price: Number(item.price) || 0,
            quantity: Number(item.quantity) || 1,
            discount: Number(item.discount) || 0,
            net_price: Number(item.net_price) || Number(item.price) || 0,
            total: Number(item.total) || 0,
            warranty: item.warranty || '',
            remaining_warranty: item.remaining_warranty || '',
          };

          const signature = rowSignature(normalizedIncomingItem);
          const existingItem = currentItemMap.get(signature);
          if (existingItem) {
            const merged = mergeMissingValues(existingItem, normalizedIncomingItem, [
              'barcode', 'name', 'price', 'quantity', 'discount', 'net_price', 'total', 'warranty', 'remaining_warranty',
            ]);
            if (merged.changed) {
              const stmt = this.db.prepare(`
                  UPDATE invoice_items
                  SET barcode = ?, name = ?, price = ?, quantity = ?, discount = ?, net_price = ?, total = ?, warranty = ?, remaining_warranty = ?
                  WHERE id = ?
                `);
              stmt.run([
                merged.next.barcode,
                merged.next.name,
                merged.next.price,
                merged.next.quantity,
                merged.next.discount,
                merged.next.net_price,
                merged.next.total,
                merged.next.warranty,
                merged.next.remaining_warranty,
                existingItem.item_id,
              ]);
              stmt.free();
              invoiceItemsUpdated += 1;
            }
          } else if (invoiceId) {
            const stmt = this.db.prepare(`
                INSERT INTO invoice_items (invoice_id, barcode, name, price, quantity, discount, net_price, total, warranty, remaining_warranty)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `);
            stmt.run([
              invoiceId,
              normalizedIncomingItem.barcode,
              normalizedIncomingItem.name,
              normalizedIncomingItem.price,
              normalizedIncomingItem.quantity,
              normalizedIncomingItem.discount,
              normalizedIncomingItem.net_price,
              normalizedIncomingItem.total,
              normalizedIncomingItem.warranty,
              normalizedIncomingItem.remaining_warranty,
            ]);
            stmt.free();
            invoiceItemsInserted += 1;
          }
        }
      }

      this.db.run('COMMIT');
      this._saveDisk();

      return {
        success: true,
        productsInserted,
        productsUpdated,
        customFieldsInserted,
        customFieldsUpdated,
        invoicesInserted,
        invoicesUpdated,
        invoiceItemsInserted,
        invoiceItemsUpdated,
        alreadySynced:
          productsInserted === 0 &&
          productsUpdated === 0 &&
          customFieldsInserted === 0 &&
          customFieldsUpdated === 0 &&
          invoicesInserted === 0 &&
          invoicesUpdated === 0 &&
          invoiceItemsInserted === 0 &&
          invoiceItemsUpdated === 0,
      };
    } catch (err) {
      try { this.db.run('ROLLBACK'); } catch (_) { /* ignore */ }
      throw err;
    }
  }

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
          transaction_type TEXT DEFAULT 'sale',
          return_reason TEXT DEFAULT '',
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
          warranty    TEXT DEFAULT '',
          remaining_warranty TEXT DEFAULT '',
          FOREIGN KEY (invoice_id) REFERENCES invoices(id)
        );
      `);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices(created_at)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_invoices_transaction_type ON invoices(transaction_type)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_invoice_items_barcode ON invoice_items(barcode)`);

    let schemaChanged = false;
    const itemColumns = this.db.exec("PRAGMA table_info(invoice_items)");
    const hasWarranty = itemColumns.length > 0 && itemColumns[0].values.some(row => row[1] === 'warranty');
    if (!hasWarranty) {
      this.db.run("ALTER TABLE invoice_items ADD COLUMN warranty TEXT DEFAULT ''");
      schemaChanged = true;
    }
    const hasRemaining = itemColumns.length > 0 && itemColumns[0].values.some(row => row[1] === 'remaining_warranty');
    if (!hasRemaining) {
      this.db.run("ALTER TABLE invoice_items ADD COLUMN remaining_warranty TEXT DEFAULT ''");
      schemaChanged = true;
    }

    const invoiceColumns = this.db.exec("PRAGMA table_info(invoices)");
    const hasTransactionType = invoiceColumns.length > 0 && invoiceColumns[0].values.some(row => row[1] === 'transaction_type');
    if (!hasTransactionType) {
      this.db.run("ALTER TABLE invoices ADD COLUMN transaction_type TEXT DEFAULT 'sale'");
      schemaChanged = true;
    }
    const hasReturnReason = invoiceColumns.length > 0 && invoiceColumns[0].values.some(row => row[1] === 'return_reason');
    if (!hasReturnReason) {
      this.db.run("ALTER TABLE invoices ADD COLUMN return_reason TEXT DEFAULT ''");
      schemaChanged = true;
    }

    if (schemaChanged) {
      this._saveDisk();
    }
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
    const baseInvoice = {
      customer_name: invoice.customer_name || '',
      customer_phone: invoice.customer_phone || '',
      cashier: invoice.cashier || '',
      subtotal: invoice.subtotal || 0,
      discount: invoice.discount || 0,
      total: invoice.total || 0,
      paid_cash: invoice.paid_cash || 0,
      balance: invoice.balance || 0,
      status: invoice.status || 'unpaid',
      transaction_type: invoice.transaction_type || 'sale',
      return_reason: invoice.return_reason || '',
    };

    let invNo = String(invoice.invoice_no || '').trim();
    if (!invNo) invNo = '';

    let lastError = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidateNo = invNo || this.generateInvoiceNumber();

      try {
        this.db.run('BEGIN TRANSACTION');

        const stmt = this.db.prepare(`
        INSERT INTO invoices 
          (invoice_no, customer_name, customer_phone, cashier, subtotal, discount, total, paid_cash, balance, status, transaction_type, return_reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
        stmt.run([
          candidateNo,
          baseInvoice.customer_name,
          baseInvoice.customer_phone,
          baseInvoice.cashier,
          baseInvoice.subtotal,
          baseInvoice.discount,
          baseInvoice.total,
          baseInvoice.paid_cash,
          baseInvoice.balance,
          baseInvoice.status,
          baseInvoice.transaction_type,
          baseInvoice.return_reason,
        ]);
        stmt.free();

        const idRes = this.db.exec('SELECT last_insert_rowid() as id');
        const invoiceId = idRes[0].values[0][0];

        for (const item of (invoice.items || [])) {
          const iStmt = this.db.prepare(`
          INSERT INTO invoice_items (invoice_id, barcode, name, price, quantity, discount, net_price, total, warranty, remaining_warranty)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
          iStmt.run([
            invoiceId,
            item.barcode || '',
            item.name || '',
            item.price || 0,
            item.quantity || 1,
            item.discount || 0,
            item.net_price || item.price || 0,
            item.total || 0,
            item.warranty || '',
            item.remaining_warranty || ''
          ]);
          iStmt.free();

          if (item.barcode) {
            if (invoice.transaction_type === 'customer_return' || invoice.transaction_type === 'used_purchase') {
              // Customer returns & used purchases both ADD stock back/in to the shop
              const uStmt = this.db.prepare(`UPDATE products SET quantity = quantity + ? WHERE barcode = ?`);
              uStmt.run([item.quantity || 1, item.barcode]);
              uStmt.free();
            } else {
              // Sales and supplier returns DEDUCT stock
              const uStmt = this.db.prepare(`UPDATE products SET quantity = MAX(0, quantity - ?) WHERE barcode = ?`);
              uStmt.run([item.quantity || 1, item.barcode]);
              uStmt.free();
            }
          }
        }

        this.db.run('COMMIT');
        this._saveDisk();
        return { success: true, invoice_no: candidateNo, id: invoiceId };
      } catch (err) {
        lastError = err;
        try { this.db.run('ROLLBACK'); } catch (_) { /* ignore */ }
        if (!/UNIQUE constraint failed: invoices\.invoice_no/i.test(String(err?.message || err))) {
          throw err;
        }
        invNo = '';
      }
    }

    throw lastError || new Error('Unable to generate a unique invoice number');
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
