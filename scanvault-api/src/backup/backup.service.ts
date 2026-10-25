import { Injectable, Logger, StreamableFile } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { Invoice } from '../invoices/invoice.schema';
import { Product } from '../products/product.schema';

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    @InjectModel(Invoice.name) private invoiceModel: Model<Invoice>,
    @InjectModel(Product.name) private productModel: Model<Product>,
    private config: ConfigService,
  ) {}

  // ─── Snapshot ─────────────────────────────────────────────────────────────

  async buildSnapshot() {
    const [products, invoices] = await Promise.all([
      this.productModel.find().lean().exec(),
      this.invoiceModel.find().lean().exec(),
    ]);

    return {
      timestamp: new Date().toISOString(),
      products,
      invoices,
    };
  }

  // ─── CSV Export ────────────────────────────────────────────────────────────

  /** Builds a full CSV of every invoice line item — mirrors the old buildFullCsvFromDb() */
  async buildCsv(): Promise<string> {
    const invoices = await this.invoiceModel.find().sort({ created_at: -1 }).lean().exec();

    const rows: string[] = [
      // Header
      [
        'invoice_no',
        'date',
        'customer_name',
        'customer_phone',
        'cashier',
        'barcode',
        'product_name',
        'quantity',
        'price',
        'discount',
        'net_price',
        'line_total',
        'invoice_subtotal',
        'invoice_discount',
        'invoice_total',
        'paid_cash',
        'balance',
        'status',
      ].join(','),
    ];

    for (const inv of invoices) {
      const date = (inv as any).created_at ? new Date((inv as any).created_at).toISOString() : '';
      for (const item of inv.items || []) {
        rows.push(
          [
            this.csvEscape(inv.invoice_no),
            date,
            this.csvEscape(inv.customer_name ?? ''),
            this.csvEscape(inv.customer_phone ?? ''),
            this.csvEscape(inv.cashier ?? ''),
            this.csvEscape(item.barcode ?? ''),
            this.csvEscape(item.name ?? ''),
            item.quantity ?? 0,
            item.price ?? 0,
            item.discount ?? 0,
            item.net_price ?? 0,
            item.total ?? 0,
            inv.subtotal ?? 0,
            inv.discount ?? 0,
            inv.total ?? 0,
            inv.paid_cash ?? 0,
            inv.balance ?? 0,
            this.csvEscape(inv.status ?? ''),
          ].join(','),
        );
      }
    }

    return rows.join('\n');
  }

  private csvEscape(val: string): string {
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  }

  // ─── R2 Upload ─────────────────────────────────────────────────────────────

  /**
   * Uploads a JSON snapshot to Cloudflare R2 using the S3-compatible API.
   * Requires env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
   *
   * Install: pnpm add @aws-sdk/client-s3
   */
  async uploadToR2(content: string, filename: string): Promise<void> {
    const accountId = this.config.get<string>('R2_ACCOUNT_ID');
    const accessKeyId = this.config.get<string>('R2_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('R2_SECRET_ACCESS_KEY');
    const bucket = this.config.get<string>('R2_BUCKET_NAME');

    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
      this.logger.warn('R2 credentials not configured — skipping cloud backup');
      return;
    }

    // Use Function constructor to avoid TypeScript static analysis of the import
    // so missing @aws-sdk/client-s3 is a runtime warning, not a compile error.
    let S3Client: any, PutObjectCommand: any;
    try {
      // eslint-disable-next-line no-new-func
      const awsSdk = await (new Function('m', 'return import(m)'))('@aws-sdk/client-s3');
      S3Client = awsSdk.S3Client;
      PutObjectCommand = awsSdk.PutObjectCommand;
    } catch {
      this.logger.warn('@aws-sdk/client-s3 not installed — skipping R2 upload. Run: pnpm add @aws-sdk/client-s3');
      return;
    }

    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: filename,
        Body: content,
        ContentType: filename.endsWith('.json') ? 'application/json' : 'text/plain',
      }),
    );

    this.logger.log(`Backup uploaded to R2: ${filename}`);
  }

  // ─── Cron ─────────────────────────────────────────────────────────────────

  @Cron('0 9 * * *')
  async runDailyBackup() {
    this.logger.log('Starting daily backup...');
    try {
      const snapshot = await this.buildSnapshot();
      const filename = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      await this.uploadToR2(JSON.stringify(snapshot, null, 2), filename);

      const csv = await this.buildCsv();
      const csvFilename = `export-${new Date().toISOString().slice(0, 10)}.csv`;
      await this.uploadToR2(csv, csvFilename);

      this.logger.log('Daily backup complete');
    } catch (err) {
      this.logger.error('Daily backup failed', err);
    }
  }
}
