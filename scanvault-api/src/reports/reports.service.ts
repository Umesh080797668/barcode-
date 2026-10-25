import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Invoice } from '../invoices/invoice.schema';
import { Product } from '../products/product.schema';

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Invoice.name) private invoiceModel: Model<Invoice>,
    @InjectModel(Product.name) private productModel: Model<Product>,
  ) {}

  // ── Legacy-compatible report format (period / name / barcode / qtySold / currentStock / revenue) ──

  /**
   * Daily product-selling breakdown — matches getReportData('daily') in legacy ReportsModule.
   * Returns rows grouped by date (YYYY-MM-DD) with per-product stats.
   */
  async getDailyReport(days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const rows = await this.invoiceModel.aggregate([
      { $match: { created_at: { $gte: since }, transaction_type: 'sale' } },
      { $unwind: '$items' },
      {
        $group: {
          _id: {
            period: {
              $dateToString: { format: '%Y-%m-%d', date: '$created_at' },
            },
            barcode: '$items.barcode',
            name: '$items.name',
          },
          qtySold: { $sum: '$items.quantity' },
          revenue: { $sum: '$items.total' },
        },
      },
      { $sort: { '_id.period': -1, revenue: -1 } },
      {
        $project: {
          _id: 0,
          period: '$_id.period',
          barcode: '$_id.barcode',
          name: '$_id.name',
          qtySold: 1,
          revenue: 1,
        },
      },
    ]);

    // Hydrate currentStock from products collection
    return this.hydrateStock(rows);
  }

  /**
   * Monthly product-selling breakdown — matches getReportData('monthly').
   */
  async getMonthlyReport(months = 12) {
    const since = new Date();
    since.setMonth(since.getMonth() - months);

    const rows = await this.invoiceModel.aggregate([
      { $match: { created_at: { $gte: since }, transaction_type: 'sale' } },
      { $unwind: '$items' },
      {
        $group: {
          _id: {
            period: {
              $dateToString: { format: '%Y-%m', date: '$created_at' },
            },
            barcode: '$items.barcode',
            name: '$items.name',
          },
          qtySold: { $sum: '$items.quantity' },
          revenue: { $sum: '$items.total' },
        },
      },
      { $sort: { '_id.period': -1, revenue: -1 } },
      {
        $project: {
          _id: 0,
          period: '$_id.period',
          barcode: '$_id.barcode',
          name: '$_id.name',
          qtySold: 1,
          revenue: 1,
        },
      },
    ]);

    return this.hydrateStock(rows);
  }

  private async hydrateStock(rows: any[]) {
    if (rows.length === 0) return rows;

    const barcodes = [...new Set(rows.map((r) => r.barcode).filter(Boolean))];
    const products = await this.productModel
      .find({ barcode: { $in: barcodes } })
      .select('barcode quantity')
      .lean()
      .exec();

    const stockMap = new Map(products.map((p) => [p.barcode, p.quantity ?? 0]));

    return rows.map((r) => ({
      ...r,
      currentStock: stockMap.get(r.barcode) ?? 0,
    }));
  }

  // ── Additional analytics ────────────────────────────────────────────────────

  /** Overall summary stats */
  async getSummary(days?: number) {
    const matchStage: any = { transaction_type: 'sale' };
    if (days) {
      const since = new Date();
      since.setDate(since.getDate() - days);
      matchStage.created_at = { $gte: since };
    }

    const result = await this.invoiceModel.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          total_revenue: { $sum: '$total' },
          total_invoices: { $sum: 1 },
          total_paid: { $sum: '$paid_cash' },
          total_balance_due: { $sum: '$balance' },
          total_discount: { $sum: '$discount' },
        },
      },
      {
        $project: {
          _id: 0,
          total_revenue: 1,
          total_invoices: 1,
          total_paid: 1,
          total_balance_due: 1,
          total_discount: 1,
          avg_order_value: {
            $cond: [
              { $gt: ['$total_invoices', 0] },
              { $divide: ['$total_revenue', '$total_invoices'] },
              0,
            ],
          },
        },
      },
    ]);

    return (
      result[0] || {
        total_revenue: 0,
        total_invoices: 0,
        total_paid: 0,
        total_balance_due: 0,
        total_discount: 0,
        avg_order_value: 0,
      }
    );
  }

  /** Top N selling products by quantity sold */
  async getTopProducts(limit = 20) {
    const rows = await this.invoiceModel.aggregate([
      { $match: { transaction_type: 'sale' } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.barcode',
          name: { $first: '$items.name' },
          total_qty: { $sum: '$items.quantity' },
          total_revenue: { $sum: '$items.total' },
        },
      },
      { $sort: { total_qty: -1 } },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          barcode: '$_id',
          name: 1,
          total_qty: 1,
          total_revenue: 1,
        },
      },
    ]);
    return this.hydrateStock(rows.map((r) => ({ ...r, qtySold: r.total_qty, revenue: r.total_revenue })));
  }

  /** Low-stock products: quantity at or below threshold */
  async getLowStock(threshold = 5) {
    return this.productModel
      .find({ quantity: { $lte: threshold } })
      .sort({ quantity: 1 })
      .select('barcode name sku quantity category')
      .lean()
      .exec();
  }

  /** Cashier performance */
  async getCashierStats(days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    return this.invoiceModel.aggregate([
      { $match: { created_at: { $gte: since }, transaction_type: 'sale' } },
      {
        $group: {
          _id: '$cashier',
          revenue: { $sum: '$total' },
          invoices: { $sum: 1 },
        },
      },
      { $sort: { revenue: -1 } },
      { $project: { _id: 0, cashier: '$_id', revenue: 1, invoices: 1 } },
    ]);
  }
}
