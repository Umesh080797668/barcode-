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
  ) { }

  private async getNextInvoiceNumber(): Promise<string> {
    const counter = await this.counterModel.findOneAndUpdate(
      { name: 'invoice_no' },
      { $inc: { seq: 1 } },
      { new: true, upsert: true },
    );
    return `INV-${String(counter!.seq).padStart(6, '0')}`;
  }

  async create(dto: CreateInvoiceDto) {
    const session = await this.connection.startSession();
    let invoice: Invoice | undefined;

    const txType = dto.transaction_type ?? 'sale';
    const isSale = txType === 'sale';
    const isCustomerReturn = txType === 'customer_return';

    try {
      await session.withTransaction(async () => {
        // ── Stock adjustments ────────────────────────────────────────────────
        for (const item of dto.items) {
          if (isSale && item.barcode) {
            // Normal sale: deduct stock (atomic guard-and-decrement)
            await this.products.sellUnit(item.barcode, item.quantity);
          } else if (isCustomerReturn && item.barcode) {
            // Customer returning goods to us: restock
            await this.products.restockUnit(item.barcode, item.quantity);
          }
          // supplier_return: stock handled separately via SupplierReturnsService
        }

        // ── Compute totals server-side ───────────────────────────────────────
        const isReturnType = isCustomerReturn || txType === 'supplier_return';
        const subtotal = dto.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
        const discount = isReturnType
          ? 0
          : dto.items.reduce((sum, i) => sum + (i.discount || 0) * i.quantity, 0);
        const total = subtotal - discount;
        const balance = isReturnType ? 0 : total - dto.paid_cash;

        const invoiceNo = await this.getNextInvoiceNumber();

        const items = dto.items.map((i) => ({
          barcode: i.barcode ?? '',
          name: i.name,
          price: i.price,
          quantity: i.quantity,
          discount: isReturnType ? 0 : (i.discount || 0),
          net_price: isReturnType ? i.price : i.price - (i.discount || 0),
          total: isReturnType ? i.price * i.quantity : (i.price - (i.discount || 0)) * i.quantity,
          warranty: i.warranty ?? '',
          remaining_warranty: i.remaining_warranty ?? '',
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
              paid_cash: isReturnType ? 0 : dto.paid_cash,
              balance: isReturnType ? 0 : balance,
              status: isReturnType
                ? txType // 'customer_return' | 'supplier_return'
                : balance > 0
                  ? 'partial'
                  : 'paid',
              transaction_type: txType,
              return_reason: dto.return_reason ?? '',
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

  /** Partial update — owner only. Used for corrections (return_reason, status, notes) */
  async update(invoiceNo: string, data: Record<string, any>) {
    // Strip fields that must not be overwritten directly
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { invoice_no, items, ...safeData } = data;
    const invoice = await this.invoiceModel.findOneAndUpdate(
      { invoice_no: invoiceNo },
      { $set: safeData },
      { new: true },
    );
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  /** Voiding/deleting a sale restocks every item it sold. Returns are left as-is. */
  async delete(invoiceNo: string) {
    const invoice = await this.findOne(invoiceNo);

    if (invoice.transaction_type === 'sale') {
      // Reverse stock deductions
      for (const item of invoice.items) {
        await this.products.restockUnit(item.barcode, item.quantity);
      }
    } else if (invoice.transaction_type === 'customer_return') {
      // Reverse the restock we did when processing the return
      for (const item of invoice.items) {
        await this.products.sellUnit(item.barcode, item.quantity);
      }
    }
    // supplier_return: stock is managed by SupplierReturnsService, not here

    await this.invoiceModel.deleteOne({ invoice_no: invoiceNo });
    return { success: true };
  }
}
