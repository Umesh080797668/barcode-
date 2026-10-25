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
  ) { }

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

  async generateBarcodeNumber(): Promise<string> {
    const counter = await this.counterModel.findOneAndUpdate(
      { name: 'barcode_seq' },
      { $inc: { seq: 1 } },
      { new: true, upsert: true },
    );
    return String(200000000000 + counter.seq);
  }

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
