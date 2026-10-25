# ScanVault: Electron → Web Migration Guide

**Stack:** Next.js (frontend) · NestJS (backend) · MongoDB (database) · Cloudflare Pages (frontend hosting) · Railway (backend hosting)

This guide takes your existing Electron + React + sql.js POS app and turns it into a hosted web app, reusing as much of your existing logic as possible.

---

## 0. What's changing vs. what's staying

| Piece | Electron version | Web version |
|---|---|---|
| Database | sql.js (SQLite file) | MongoDB (Atlas) |
| Frontend framework | Vite + React | Next.js (same React components, new routing) |
| Backend/IPC | `ipcMain.handle(...)` in `main.cjs` | NestJS REST controllers |
| Barcode generation | `barcodeDB.generateBarcodeNumber()` | Same function, moved into a NestJS service — **no rewrite needed** |
| Barcode scanning | Keyboard-wedge USB scanner into a focused input | **Unchanged** — works identically in a browser |
| Receipt printing | `webContents.print()` (native) | QZ Tray local print agent (see §6) |
| "Used Purchase" window | Separate Electron `BrowserWindow` | `/used-purchase` route in Next.js |
| Backups/CSV | Local filesystem, 9 AM cron via `setTimeout` | NestJS `@nestjs/schedule` cron → Cloudflare R2 or S3 |
| Auto-updater | Downloads and launches `.exe` | Not needed — web deploys are instant |
| Access control | Implicit — one PC, one shop | Login required: owner and cashier accounts, one shared portal, owner is a superset role |

---

## 1. Accounts you'll need

- [Railway](https://railway.app) — backend hosting
- [Cloudflare](https://dash.cloudflare.com) — Pages (frontend) + DNS
- [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) — free M0 cluster is enough for one shop
- [QZ Tray](https://qz.io) — free, for silent receipt printing (installed on the till's PC, not hosted)

---

## 2. MongoDB Atlas setup

1. Create a free **M0** cluster (512MB — plenty for products/invoices for a single shop for years).
2. Database Access → create a user with a strong password (this is your `MONGO_USER` / `MONGO_PASS`).
3. Network Access → for now, allow access from anywhere (`0.0.0.0/0`) since Railway's outbound IPs aren't fixed on the free/hobby tier. Tighten later if you upgrade to a plan with static IPs.
4. Copy the connection string:
   ```
   mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/scanvault?retryWrites=true&w=majority
   ```

---

## 3. NestJS backend

### 3.1 Project setup

```bash
npm i -g @nestjs/cli
nest new scanvault-api
cd scanvault-api
npm install @nestjs/mongoose mongoose @nestjs/config @nestjs/schedule class-validator class-transformer
```

### 3.2 Folder structure

```
src/
  products/
    product.schema.ts
    products.service.ts
    products.controller.ts
    products.module.ts
  invoices/
    invoice.schema.ts        # items embedded as subdocuments
    invoices.service.ts
    invoices.controller.ts
    invoices.module.ts
  supplier-returns/
    supplier-return.schema.ts
    supplier-returns.service.ts
    supplier-returns.controller.ts
    supplier-returns.module.ts
  custom-fields/
    custom-field.schema.ts
    custom-fields.service.ts
    custom-fields.controller.ts
    custom-fields.module.ts
  reports/
    reports.service.ts
    reports.controller.ts
  backup/
    backup.service.ts         # cron job, replaces main.cjs auto-backup
    backup.controller.ts
  app.module.ts
  main.ts
```

### 3.3 Schemas (ported from your SQLite tables)

**`product.schema.ts`**
```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class Product extends Document {
  @Prop({ required: true, unique: true })
  barcode: string;

  @Prop() name: string;
  @Prop() sku: string;
  @Prop() price: number;
  @Prop({ default: 0 }) quantity: number;
  @Prop({ default: 'normal' }) scan_mode: string;
  @Prop() category: string;

  // was TEXT-serialized JSON in SQLite — now a native object, no parse/stringify needed
  @Prop({ type: Object, default: {} })
  custom_fields: Record<string, any>;
}

export const ProductSchema = SchemaFactory.createForClass(Product);
```

**`invoice.schema.ts`** — note: `invoice_items` was a separate SQLite table joined by `invoice_id`. In MongoDB, embed items directly; you lose nothing since you never query items independently of their invoice.

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ _id: false })
export class InvoiceItem {
  @Prop() barcode: string;
  @Prop() name: string;
  @Prop() price: number;
  @Prop({ default: 1 }) quantity: number;
  @Prop({ default: 0 }) discount: number;
  @Prop() net_price: number;
  @Prop() total: number;
  @Prop({ default: '' }) warranty: string;
  @Prop({ default: '' }) remaining_warranty: string;
}
export const InvoiceItemSchema = SchemaFactory.createForClass(InvoiceItem);

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: false } })
export class Invoice extends Document {
  @Prop({ required: true, unique: true })
  invoice_no: string;

  @Prop() customer_name: string;
  @Prop() customer_phone: string;
  @Prop() cashier: string;
  @Prop({ default: 0 }) subtotal: number;
  @Prop({ default: 0 }) discount: number;
  @Prop({ default: 0 }) total: number;
  @Prop({ default: 0 }) paid_cash: number;
  @Prop({ default: 0 }) balance: number;
  @Prop({ default: 'unpaid' }) status: string;
  @Prop({ default: 'sale' }) transaction_type: string;
  @Prop({ default: '' }) return_reason: string;

  @Prop({ type: [InvoiceItemSchema], default: [] })
  items: InvoiceItem[];
}
export const InvoiceSchema = SchemaFactory.createForClass(Invoice);
```

**`supplier-return.schema.ts`** and **`custom-field.schema.ts`** — same pattern, straight field-for-field port from the `CREATE TABLE` statements you already have. If you want, paste me the exact fields again and I'll write these two out fully too.

### 3.4 Controllers — mapping your old IPC channels

Every `ipcMain.handle('channel:name', ...)` becomes one controller method. This table is your literal checklist:

| Old IPC channel | New endpoint |
|---|---|
| `barcode:generate` | `GET /products/generate-barcode` |
| `barcode:getProducts` | `GET /products` |
| `barcode:getProduct` | `GET /products/:barcode` |
| `barcode:saveProduct` | `POST /products` |
| `barcode:deleteProduct` | `DELETE /products/:id` |
| `barcode:getCustomFields` | `GET /custom-fields` |
| `barcode:saveCustomField` | `POST /custom-fields` |
| `invoice:save` | `POST /invoices` |
| `invoice:getAll` | `GET /invoices?limit=` |
| `invoice:get` | `GET /invoices/:invoiceNo` |
| `invoice:getByCustomer` | `GET /invoices/search?customer=` |
| `invoice:delete` | `DELETE /invoices/:invoiceNo` |
| `invoice:update` | `PATCH /invoices/:invoiceNo` |
| `returns:save` | `POST /supplier-returns` |
| `returns:getAll` | `GET /supplier-returns?limit=` |
| `returns:receiveReplacement` | `PATCH /supplier-returns/:id/receive` |
| `reports:getData` | `GET /reports/:type` |
| `backup:create` | `POST /backup/run` |
| `csv:exportAll` | `GET /backup/export.csv` (streams file to browser instead of writing to disk) |

The barcode-generation logic itself (whatever checksum/sequence scheme is in `generateBarcodeNumber()`) copies over verbatim into `ProductsService` — it has no Electron dependency.

### 3.5 `main.ts` — enable CORS for your Next.js frontend

```typescript
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: [process.env.FRONTEND_URL], // your Cloudflare Pages URL
    credentials: true,
  });
  await app.listen(process.env.PORT || 3001);
}
```

---

## 4. Next.js frontend

### 4.1 Project setup

```bash
npx create-next-app@latest scanvault-web --typescript
```

### 4.2 Porting your existing components

Your component files (`BillingModule.jsx`, `ReportsModule.jsx`, `BarcodeGenerator.jsx`, `UsedPurchaseModule.jsx`, `SupplierReturnsModule.jsx`) move into `app/` largely unchanged. The only edits needed:

1. Replace every `window.electronAPI.xxx(...)` call with a `fetch()`/API client call to the matching NestJS endpoint from the table above.
2. Replace the separate "Used Purchase" `BrowserWindow` with a normal route: `app/used-purchase/page.tsx`.
3. Centralize the API base URL in one place:

```typescript
// lib/api.ts
const API_URL = process.env.NEXT_PUBLIC_API_URL; // Railway backend URL

export async function getProducts() {
  const res = await fetch(`${API_URL}/products`);
  return res.json();
}
// ...one function per old IPC call, same names if you like, for minimal diff
```

A clean approach: name every function in `lib/api.ts` exactly like the old IPC channel (`generateBarcode`, `saveProduct`, `getInvoices`...) so the diff inside your components is nearly just `window.electronAPI.` → `api.`.

---

## 5. Barcode generation & scanning

No changes needed here beyond the plumbing above:

- **Generation**: pure JS logic, moves into `ProductsService.generateBarcodeNumber()`.
- **Scanning**: your USB scanners work as keyboard-wedge devices — they'll type into any focused browser input exactly as they did into the Electron window. Nothing to build.

---

## 6. Receipt printing (the part that actually changes)

Electron's native `webContents.print()` doesn't exist in a browser. Use **QZ Tray**:

1. Install QZ Tray once on the till's PC (free, from qz.io).
2. In your Next.js app, add the `qz-tray` JS library.
3. Port your `buildReceiptHTML(invoice, shopConfig)` function as-is — it already produces the receipt HTML/CSS, that part doesn't change.
4. Instead of sending that HTML to Electron's print handler, send it to QZ Tray over its local WebSocket:

```typescript
import qz from 'qz-tray';

async function printReceipt(html: string, printerName: string) {
  await qz.websocket.connect();
  const config = qz.configs.create(printerName);
  await qz.print(config, [{ type: 'html', format: 'plain', data: html }]);
}
```

5. Printer selection (`printer:list` in your old code) becomes `qz.printers.find()`.

This preserves the "click sell, receipt prints, no dialog" experience your cashier is used to.

---

## 7. Backups & CSV export

- Your `runAutoBackup()` 9 AM scheduler becomes a NestJS cron job:

```typescript
import { Cron } from '@nestjs/schedule';

@Cron('0 9 * * *')
async runDailyBackup() {
  const snapshot = await this.buildSnapshot(); // same shape as exportBackupSnapshot()
  await this.uploadToR2(JSON.stringify(snapshot), `backup-${new Date().toISOString()}.json`);
}
```

- Point this at **Cloudflare R2** (S3-compatible, cheap, pairs naturally with the rest of your Cloudflare setup) instead of local disk.
- User-triggered CSV export (`csv:exportAll`) becomes a controller endpoint that builds the same CSV string your `buildFullCsvFromDb()` already produces, and streams it back as a file download — the browser's native download replaces the "write to local path" step.

---

## 8. Concurrency & real-time sync (critical for multi-cashier use)

The old sql.js setup was implicitly single-user — only one Electron process ever touched the database file at once. With 2-3 cashiers hitting the same backend simultaneously, several specific patterns will silently corrupt data if not built in from the start.

### 8.1 Invoice numbers — atomic counter, not "read max + 1"

If invoice numbering works by reading the last invoice number and adding 1, two cashiers checking out in the same second can compute the same next number, producing duplicate invoice numbers.

Fix: use an atomic counter document that MongoDB increments in a single operation, so two simultaneous calls can never receive the same value.

```typescript
// counter.schema.ts
@Schema()
export class Counter extends Document {
  @Prop({ required: true, unique: true }) name: string;
  @Prop({ default: 0 }) seq: number;
}
export const CounterSchema = SchemaFactory.createForClass(Counter);
```

```typescript
// invoices.service.ts
async getNextInvoiceNumber(): Promise<number> {
  const counter = await this.counterModel.findOneAndUpdate(
    { name: 'invoice_no' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );
  return counter.seq;
}
```

### 8.2 Stock quantity — atomic guard-and-decrement, not "read then write"

If two cashiers scan the last unit of a product within the same second, a naive "read quantity, check if > 0, write quantity - 1" flow lets both succeed, resulting in a negative stock count and the same item sold twice.

Fix: never separate the check from the write. Do both as one atomic operation, and treat a failed match as "someone already took it," not an error to retry blindly.

```typescript
// products.service.ts
async sellUnit(barcode: string, qty: number) {
  const result = await this.productModel.findOneAndUpdate(
    { barcode, quantity: { $gte: qty } },   // guard: only succeeds if enough stock exists
    { $inc: { quantity: -qty } },
    { new: true },
  );
  if (!result) {
    throw new ConflictException(`Insufficient stock for ${barcode}`);
  }
  return result;
}
```

Apply the same pattern anywhere else a quantity or count is modified based on its current value (e.g. supplier return replacement stock, if it also adjusts quantities).

### 8.3 Real-time sync across tills — WebSockets

When cashier A sells the last unit, cashier B's screen should reflect that without a manual refresh. NestJS supports this natively via `@nestjs/websockets`.

```bash
npm install @nestjs/websockets @nestjs/platform-socket.io socket.io
```

```typescript
// events.gateway.ts
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({ cors: { origin: process.env.FRONTEND_URL } })
export class EventsGateway {
  @WebSocketServer() server: Server;

  broadcastStockUpdate(barcode: string, newQuantity: number) {
    this.server.emit('stock:updated', { barcode, quantity: newQuantity });
  }

  broadcastNewInvoice(invoice: any) {
    this.server.emit('invoice:created', invoice);
  }
}
```

Call `broadcastStockUpdate(...)` right after a successful `sellUnit(...)` in `ProductsService`, and `broadcastNewInvoice(...)` after a successful invoice save. On the Next.js side, connect once with `socket.io-client` and update local component state when these events arrive — no polling needed.

### 8.4 Editing the same record twice — optimistic locking

Less likely than the two above in a pure checkout flow, but relevant if invoices or products are ever edited directly (e.g. correcting a price). Mongoose gives every document a built-in `__v` version field for free; check it on update so a stale edit is rejected instead of silently overwriting a newer one:

```typescript
async updateProduct(id: string, data: Partial<Product>, expectedVersion: number) {
  const result = await this.productModel.findOneAndUpdate(
    { _id: id, __v: expectedVersion },
    { $set: data, $inc: { __v: 1 } },
    { new: true },
  );
  if (!result) {
    throw new ConflictException('This record was changed by someone else — reload and retry.');
  }
  return result;
}
```

---

## 9. Deployment

### 8.1 Backend → Railway

1. Push `scanvault-api` to a GitHub repo.
2. Railway → New Project → Deploy from GitHub repo.
3. Add environment variables:
   ```
   MONGO_URI=mongodb+srv://...
   FRONTEND_URL=https://your-app.pages.dev
   PORT=3001
   ```
4. Railway auto-detects Node and deploys. Note the generated `*.up.railway.app` URL (or attach a custom domain via Cloudflare DNS).

### 8.2 Frontend → Cloudflare Pages

1. Push `scanvault-web` to GitHub.
2. Cloudflare dashboard → Workers & Pages → Create → Pages → connect the repo.
3. Framework preset: Next.js. Build command: `npm run build`.
4. Environment variable:
   ```
   NEXT_PUBLIC_API_URL=https://your-backend.up.railway.app
   ```
5. Deploy. Cloudflare gives you a `*.pages.dev` URL immediately; attach your own domain in Cloudflare DNS if you have one.

### 8.3 Cost check

Using the free subdomains Cloudflare Pages and Railway both provide (`*.pages.dev` / `*.up.railway.app`), no domain purchase is needed:

| Service | Plan | Cost |
|---|---|---|
| Cloudflare Pages | Free | $0 |
| Railway | Hobby, usage-based | ~$5–10/mo depending on traffic |
| MongoDB Atlas | M0 free tier | $0 |
| **Total** | | **~$5–10/month** |

---

## 10. Testing checklist before go-live

- [ ] Product CRUD works end-to-end (add, edit barcode, delete)
- [ ] USB scanner input still populates the search/scan field correctly
- [ ] A full sale creates an invoice with correct totals and prints a receipt via QZ Tray
- [ ] Supplier return + replacement flow matches old behavior
- [ ] Reports module pulls correct data ranges
- [ ] CSV export downloads correctly in the browser
- [ ] Daily backup cron actually lands a file in R2
- [ ] CORS works from your real Cloudflare Pages domain (test after deploying, not just `localhost`)
- [ ] **Concurrency test:** two browser sessions selling the last unit of the same product at the same time — one succeeds, the other gets a clean "out of stock" error, quantity never goes negative
- [ ] **Concurrency test:** two sessions checking out simultaneously never produce duplicate invoice numbers
- [ ] **Real-time test:** a stock change made on one screen appears on a second screen without a manual refresh

---

## 11. Full backend code: Products & Invoices

This is the real, wireable code for the two core services — everything from §3 and §8 combined, plus the two remaining schemas. Drop these files in as-is and adjust field names only if your actual SQLite columns differ slightly from what was inspected earlier.

### 11.1 Remaining schemas

**`supplier-return.schema.ts`**
```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: false } })
export class SupplierReturn extends Document {
  @Prop({ required: true }) returned_barcode: string;
  @Prop() returned_name: string;
  @Prop({ default: 1 }) returned_qty: number;
  @Prop({ default: 'no_replacement' }) return_type: string;
  @Prop() replacement_barcode: string;
  @Prop() replacement_name: string;
  @Prop({ default: 0 }) replacement_qty: number;
  @Prop() notes: string;
  @Prop({ default: false }) received: boolean;
}
export const SupplierReturnSchema = SchemaFactory.createForClass(SupplierReturn);
```

**`custom-field.schema.ts`**
```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema()
export class CustomField extends Document {
  @Prop({ required: true }) label: string;
  @Prop({ default: 'text' }) field_type: string;
  @Prop({ default: '' }) default_val: string;
  @Prop({ default: 0 }) sort_order: number;
}
export const CustomFieldSchema = SchemaFactory.createForClass(CustomField);
```

### 11.2 DTOs (request validation)

```typescript
// dto/create-product.dto.ts
import { IsString, IsNumber, IsOptional, Min } from 'class-validator';

export class CreateProductDto {
  @IsString() barcode: string;
  @IsString() name: string;
  @IsOptional() @IsString() sku?: string;
  @IsNumber() @Min(0) price: number;
  @IsNumber() @Min(0) quantity: number;
  @IsOptional() @IsString() category?: string;
  @IsOptional() custom_fields?: Record<string, any>;
}
```

```typescript
// dto/create-invoice.dto.ts
import { IsString, IsNumber, IsArray, IsOptional } from 'class-validator';

export class InvoiceItemDto {
  @IsString() barcode: string;
  @IsString() name: string;
  @IsNumber() price: number;
  @IsNumber() quantity: number;
  @IsOptional() @IsNumber() discount?: number;
}

export class CreateInvoiceDto {
  @IsOptional() @IsString() customer_name?: string;
  @IsOptional() @IsString() customer_phone?: string;
  @IsString() cashier: string;
  @IsNumber() paid_cash: number;
  @IsArray() items: InvoiceItemDto[];
}
```

### 11.3 `products.service.ts` — full

```typescript
import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Product } from './product.schema';
import { Counter } from '../common/counter.schema';
import { CreateProductDto } from './dto/create-product.dto';
import { EventsGateway } from '../events/events.gateway';

@Injectable()
export class ProductsService {
  constructor(
    @InjectModel(Product.name) private productModel: Model<Product>,
    @InjectModel(Counter.name) private counterModel: Model<Counter>,
    private events: EventsGateway,
  ) {}

  async findAll(query: { category?: string; search?: string } = {}) {
    const filter: any = {};
    if (query.category) filter.category = query.category;
    if (query.search) {
      filter.$or = [
        { name: { $regex: query.search, $options: 'i' } },
        { barcode: { $regex: query.search, $options: 'i' } },
        { sku: { $regex: query.search, $options: 'i' } },
      ];
    }
    return this.productModel.find(filter).sort({ created_at: -1 }).exec();
  }

  async findByBarcode(barcode: string) {
    const product = await this.productModel.findOne({ barcode }).exec();
    if (!product) throw new NotFoundException(`No product with barcode ${barcode}`);
    return product;
  }

  async create(dto: CreateProductDto) {
    return this.productModel.create(dto);
  }

  async update(id: string, dto: Partial<CreateProductDto>, expectedVersion: number) {
    const result = await this.productModel.findOneAndUpdate(
      { _id: id, __v: expectedVersion },
      { $set: dto, $inc: { __v: 1 } },
      { new: true },
    );
    if (!result) {
      throw new ConflictException('This product was changed by someone else — reload and retry.');
    }
    return result;
  }

  async delete(id: string) {
    const result = await this.productModel.findByIdAndDelete(id);
    if (!result) throw new NotFoundException('Product not found');
    return { success: true };
  }

  /** Atomic checksum-based barcode number — port your existing algorithm's core logic here
   *  if it's more than a simple counter; shown here as a sequential fallback. */
  async generateBarcodeNumber(): Promise<string> {
    const counter = await this.counterModel.findOneAndUpdate(
      { name: 'barcode_seq' },
      { $inc: { seq: 1 } },
      { new: true, upsert: true },
    );
    return String(1000000 + counter.seq).padStart(7, '0');
  }

  /** Guard-and-decrement in one atomic op — see guide §8.2 for why this matters. */
  async sellUnit(barcode: string, qty: number) {
    const result = await this.productModel.findOneAndUpdate(
      { barcode, quantity: { $gte: qty } },
      { $inc: { quantity: -qty } },
      { new: true },
    );
    if (!result) {
      throw new ConflictException(`Insufficient stock for ${barcode}`);
    }
    this.events.broadcastStockUpdate(barcode, result.quantity);
    return result;
  }

  /** Reverses a sale — used by invoice deletion/void and by supplier-return receipt. */
  async restockUnit(barcode: string, qty: number) {
    const result = await this.productModel.findOneAndUpdate(
      { barcode },
      { $inc: { quantity: qty } },
      { new: true },
    );
    if (result) this.events.broadcastStockUpdate(barcode, result.quantity);
    return result;
  }
}
```

### 11.4 `invoices.service.ts` — full, with a transaction tying invoice creation to stock changes

Selling several items on one invoice means multiple stock decrements plus one invoice insert. If the process crashes halfway, you don't want an invoice with only some of its stock deducted. MongoDB transactions (available on Atlas by default, since it's a replica set) make this one all-or-nothing operation.

```typescript
import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Connection } from 'mongoose';
import { Invoice } from './invoice.schema';
import { Counter } from '../common/counter.schema';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { ProductsService } from '../products/products.service';
import { EventsGateway } from '../events/events.gateway';

@Injectable()
export class InvoicesService {
  constructor(
    @InjectModel(Invoice.name) private invoiceModel: Model<Invoice>,
    @InjectModel(Counter.name) private counterModel: Model<Counter>,
    @InjectConnection() private connection: Connection,
    private products: ProductsService,
    private events: EventsGateway,
  ) {}

  private async getNextInvoiceNumber(): Promise<string> {
    const counter = await this.counterModel.findOneAndUpdate(
      { name: 'invoice_no' },
      { $inc: { seq: 1 } },
      { new: true, upsert: true },
    );
    return `INV-${String(counter.seq).padStart(6, '0')}`;
  }

  async create(dto: CreateInvoiceDto) {
    const session = await this.connection.startSession();
    let invoice: Invoice;

    try {
      await session.withTransaction(async () => {
        // 1. Decrement stock for every item first — if any item is out of stock,
        //    this throws and the whole transaction rolls back, including the invoice number.
        for (const item of dto.items) {
          await this.products.sellUnit(item.barcode, item.quantity);
        }

        // 2. Compute totals server-side — never trust totals sent from the client.
        const subtotal = dto.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
        const discount = dto.items.reduce((sum, i) => sum + (i.discount || 0) * i.quantity, 0);
        const total = subtotal - discount;
        const balance = total - dto.paid_cash;

        const invoiceNo = await this.getNextInvoiceNumber();

        const items = dto.items.map((i) => ({
          ...i,
          discount: i.discount || 0,
          net_price: i.price - (i.discount || 0),
          total: (i.price - (i.discount || 0)) * i.quantity,
        }));

        const [created] = await this.invoiceModel.create(
          [
            {
              invoice_no: invoiceNo,
              customer_name: dto.customer_name,
              customer_phone: dto.customer_phone,
              cashier: dto.cashier,
              subtotal,
              discount,
              total,
              paid_cash: dto.paid_cash,
              balance,
              status: balance > 0 ? 'partial' : 'paid',
              transaction_type: 'sale',
              items,
            },
          ],
          { session },
        );
        invoice = created;
      });
    } finally {
      await session.endSession();
    }

    this.events.broadcastNewInvoice(invoice!);
    return invoice!;
  }

  async findAll(limit = 100) {
    return this.invoiceModel.find().sort({ created_at: -1 }).limit(limit).exec();
  }

  async findByCustomer(query: string) {
    return this.invoiceModel
      .find({
        $or: [
          { customer_name: { $regex: query, $options: 'i' } },
          { customer_phone: { $regex: query, $options: 'i' } },
        ],
      })
      .sort({ created_at: -1 })
      .exec();
  }

  async findOne(invoiceNo: string) {
    const invoice = await this.invoiceModel.findOne({ invoice_no: invoiceNo });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  /** Voiding/deleting an invoice restocks every item it sold. */
  async delete(invoiceNo: string) {
    const invoice = await this.findOne(invoiceNo);
    for (const item of invoice.items) {
      await this.products.restockUnit(item.barcode, item.quantity);
    }
    await this.invoiceModel.deleteOne({ invoice_no: invoiceNo });
    return { success: true };
  }
}
```

### 11.5 Controllers

```typescript
// products.controller.ts
import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';

@Controller('products')
export class ProductsController {
  constructor(private readonly service: ProductsService) {}

  @Get() findAll(@Query() query: any) { return this.service.findAll(query); }
  @Get('generate-barcode') generateBarcode() { return this.service.generateBarcodeNumber(); }
  @Get(':barcode') findOne(@Param('barcode') barcode: string) { return this.service.findByBarcode(barcode); }
  @Post() create(@Body() dto: CreateProductDto) { return this.service.create(dto); }
  @Patch(':id') update(@Param('id') id: string, @Body() body: any) {
    return this.service.update(id, body.data, body.expectedVersion);
  }
  @Delete(':id') delete(@Param('id') id: string) { return this.service.delete(id); }
}
```

```typescript
// invoices.controller.ts
import { Controller, Get, Post, Delete, Body, Param, Query } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';

@Controller('invoices')
export class InvoicesController {
  constructor(private readonly service: InvoicesService) {}

  @Get() findAll(@Query('limit') limit?: string) { return this.service.findAll(limit ? +limit : undefined); }
  @Get('search') search(@Query('customer') customer: string) { return this.service.findByCustomer(customer); }
  @Get(':invoiceNo') findOne(@Param('invoiceNo') invoiceNo: string) { return this.service.findOne(invoiceNo); }
  @Post() create(@Body() dto: CreateInvoiceDto) { return this.service.create(dto); }
  @Delete(':invoiceNo') delete(@Param('invoiceNo') invoiceNo: string) { return this.service.delete(invoiceNo); }
}
```

### 11.6 Module wiring

```typescript
// products.module.ts
@Module({
  imports: [MongooseModule.forFeature([
    { name: Product.name, schema: ProductSchema },
    { name: Counter.name, schema: CounterSchema },
  ])],
  controllers: [ProductsController],
  providers: [ProductsService, EventsGateway],
  exports: [ProductsService],
})
export class ProductsModule {}
```

```typescript
// invoices.module.ts
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Counter.name, schema: CounterSchema },
    ]),
    ProductsModule, // InvoicesService depends on ProductsService for sellUnit/restockUnit
  ],
  controllers: [InvoicesController],
  providers: [InvoicesService, EventsGateway],
})
export class InvoicesModule {}
```

---

## 12. Authentication & roles (owner vs. cashier, one shared portal)

Since the app is now reachable by URL rather than confined to one shop PC, it needs login. The requirement — owner and cashier both use the same portal, but the owner also has full cashier ability plus extra admin screens — is a **role hierarchy**, not two separate apps: cashier is the baseline permission set, owner is a superset of it.

### 12.1 User schema

```typescript
// users/user.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: false } })
export class User extends Document {
  @Prop({ required: true, unique: true }) username: string;
  @Prop({ required: true }) password_hash: string;
  @Prop({ required: true, enum: ['owner', 'cashier'], default: 'cashier' }) role: 'owner' | 'cashier';
  @Prop({ required: true }) display_name: string;
  @Prop({ default: true }) active: boolean;
}
export const UserSchema = SchemaFactory.createForClass(User);
```

Seed the first owner account manually (once) via a script or Mongo shell — don't expose an open signup endpoint for a POS system:

```typescript
// scripts/seed-owner.ts
import * as bcrypt from 'bcrypt';
// ... connect to Mongo, then:
await userModel.create({
  username: 'owner',
  password_hash: await bcrypt.hash('choose-a-real-password', 10),
  role: 'owner',
  display_name: 'Shop Owner',
});
```

### 12.2 Auth module

```bash
npm install @nestjs/passport passport passport-jwt @nestjs/jwt bcrypt
npm install -D @types/passport-jwt @types/bcrypt
```

```typescript
// auth/auth.service.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../users/user.schema';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    private jwt: JwtService,
  ) {}

  async login(username: string, password: string) {
    const user = await this.userModel.findOne({ username, active: true });
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw new UnauthorizedException('Invalid username or password');
    }
    const payload = { sub: user._id, username: user.username, role: user.role, name: user.display_name };
    return {
      access_token: this.jwt.sign(payload),
      user: { username: user.username, role: user.role, name: user.display_name },
    };
  }
}
```

```typescript
// auth/jwt.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET,
    });
  }
  async validate(payload: any) {
    // becomes req.user in every controller
    return { userId: payload.sub, username: payload.username, role: payload.role, name: payload.name };
  }
}
```

```typescript
// auth/auth.controller.ts
import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('login')
  login(@Body() body: { username: string; password: string }) {
    return this.auth.login(body.username, body.password);
  }
}
```

### 12.3 Role guard — owner is a superset, not a separate path

```typescript
// auth/roles.decorator.ts
import { SetMetadata } from '@nestjs/common';
export const Roles = (...roles: string[]) => SetMetadata('roles', roles);
```

```typescript
// auth/roles.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.get<string[]>('roles', context.getHandler());
    if (!required) return true; // no @Roles(...) → any logged-in user (cashier or owner)

    const { user } = context.switchToHttp().getRequest();
    // owner can do anything a cashier can, plus anything explicitly restricted to owner
    return user.role === 'owner' || required.includes(user.role);
  }
}
```

Apply globally alongside the JWT guard in `main.ts` or per-module — every endpoint requires login by default; only endpoints marked `@Roles('owner')` are admin-only:

```typescript
// products.controller.ts — example of the split
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('products')
export class ProductsController {
  @Get() findAll() { ... }                          // cashier + owner: browsing stock while selling
  @Get(':barcode') findOne() { ... }                 // cashier + owner

  @Roles('owner')
  @Post() create() { ... }                           // owner only: adding new stock/pricing

  @Roles('owner')
  @Delete(':id') delete() { ... }                    // owner only
}
```

```typescript
// invoices.controller.ts — selling is a shared action; deleting/voiding is owner-only
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('invoices')
export class InvoicesController {
  @Post() create() { ... }                           // cashier + owner: this is the actual sale
  @Get() findAll() { ... }                           // cashier + owner

  @Roles('owner')
  @Delete(':invoiceNo') delete() { ... }              // owner only: voiding a sale
}
```

A sensible default split for a shop like this:

| Action | Cashier | Owner |
|---|---|---|
| Make a sale, scan/search products | ✅ | ✅ |
| View today's invoices | ✅ | ✅ |
| Add/edit products, change prices | ❌ | ✅ |
| Delete/void an invoice | ❌ | ✅ |
| View reports (revenue, trends) | ❌ | ✅ |
| Manage supplier returns | ❌ or limited | ✅ |
| Manage cashier accounts | ❌ | ✅ |

Adjust freely — the point is the guard checks `role === 'owner'` first, so the owner never hits a wall; only cashier accounts are restricted.

### 12.4 Trust the token, not the client, for "who's the cashier"

Your old `CreateInvoiceDto.cashier` field took the cashier name as free text from the client — fine for a single trusted PC, not fine once multiple accounts share the API. Derive it from the authenticated user instead:

```typescript
// invoices.controller.ts
@Post()
create(@Body() dto: CreateInvoiceDto, @Req() req) {
  return this.service.create({ ...dto, cashier: req.user.name }); // ignore any cashier field the client sent
}
```

### 12.5 Frontend — one portal, role-aware navigation

```typescript
// after login, store { access_token, user: { role, name } } — e.g. in an auth context/store
// nav renders conditionally:

const navItems = [
  { label: 'Sell', path: '/pos', roles: ['cashier', 'owner'] },
  { label: 'Today\'s Invoices', path: '/invoices', roles: ['cashier', 'owner'] },
  { label: 'Products', path: '/products', roles: ['owner'] },
  { label: 'Reports', path: '/reports', roles: ['owner'] },
  { label: 'Users', path: '/settings/users', roles: ['owner'] },
];

const visibleNav = navItems.filter(item => item.roles.includes(currentUser.role));
```

The owner logs into the exact same URL and sees the cashier's "Sell" screen plus their own admin sections — no separate build, no separate deployment. Attach the JWT to every `fetch` call from `lib/api.ts` as an `Authorization: Bearer <token>` header, and have the NestJS guards reject anything without a valid one.

---

## 13. Performance: fast, smooth, and responsive under real till use

A POS screen has a specific performance bar: scanning a barcode, seeing it appear in the cart, and the total updating should all feel instant — a laggy till is the fastest way to lose trust in the switch from Electron. Here's where to spend effort.

### 13.1 Backend response speed

- **Index every field you query or filter by.** At minimum: `barcode` (unique index, already implied by `unique: true`), `invoice_no` (same), and `created_at` on both `Product` and `Invoice` for sorted list views.
  ```typescript
  @Prop({ index: true }) category: string; // add wherever findAll() filters
  ```
- **Keep the hot path (`sellUnit`, invoice creation) free of anything that isn't strictly needed to complete the sale.** Non-critical work — updating a report cache, logging analytics — should happen asynchronously after the response is sent, not inside the transaction.
- **Cap list queries.** `findAll()` should always have a sane default `limit` (you already have this on invoices) so a "get all products" call never scales badly as the catalog grows.
- **Railway**: since you're not on the free tier (per the earlier hosting discussion), your NestJS process stays warm — no cold-start lag on the first sale of the day.

### 13.2 Real-time updates that feel instant, not janky

The WebSocket layer from §8.3 already avoids polling delay. Two refinements for smoothness:

- **Optimistic UI updates.** When a cashier adds an item to the cart or completes a sale, update the screen immediately from the local action, then reconcile with the server's response/WebSocket event when it arrives — don't make the cashier watch a spinner for a round-trip that should feel instant. Only roll back visually if the server actually rejects it (e.g. the `ConflictException` from `sellUnit` on a stock race).
- **Scope WebSocket broadcasts**, don't blast every event to every connected client if the shop ever grows to multiple branches — use Socket.IO rooms (one room per shop/branch) so updates stay relevant and small.

### 13.3 Frontend smoothness (Next.js)

- **Route transitions**: Next.js's App Router does this well by default (client-side navigation, no full page reload) — just make sure heavy pages (Reports, with charts) don't block the POS route's own bundle. Use `next/dynamic` to lazy-load anything not needed for the core "Sell" screen:
  ```typescript
  const ReportsModule = dynamic(() => import('./ReportsModule'), { ssr: false });
  ```
- **Animate with CSS transforms/opacity only** (not layout-triggering properties like `width`/`top`) for cart item add/remove, page transitions, and modals — these run on the compositor thread and stay smooth even on modest till hardware. Libraries like `framer-motion` make this easy if you want polished transitions without hand-tuning CSS.
- **Debounce the product search/autocomplete** input (150–250ms) so fast typing doesn't fire a network request per keystroke.
- **Prefetch** the POS route's data (product list, recent invoices) as soon as login succeeds, rather than waiting for the user to navigate there.

### 13.4 Where Cloudflare actively helps this

- Cloudflare Pages serves your Next.js static assets from its global CDN edge network — fast load times regardless of where the shop is relative to Railway's server region.
- Turn on **Cloudflare's Auto Minify** and **Brotli compression** (on by default) for the frontend to shrink JS/CSS payloads.
- If you outgrow the free Pages tier's edge caching for dynamic API calls, Cloudflare's **cache rules** can cache genuinely static API responses (e.g. the custom-fields list, which rarely changes) at the edge, cutting a full round-trip to Railway for data that doesn't need to be fetched fresh every time.

None of this requires a different architecture from what's already in this guide — it's about applying indexes, optimistic UI, and lazy-loading consistently as you build out each module, rather than retrofitting it after the app feels sluggish.

---

## Open questions for next steps

- Do you want the `SupplierReturnsService`/`CustomFieldsService` and `ReportsService` written out with the same level of detail as §11, to fully close out the backend?
- Do you want a password-reset flow for cashier accounts (owner-triggered, since there's no email/SMS setup yet), or is manual reset by the owner through a "Users" admin screen enough for now?
