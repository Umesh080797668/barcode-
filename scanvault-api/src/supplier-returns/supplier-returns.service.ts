import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SupplierReturn } from './supplier-return.schema';
import { ProductsService } from '../products/products.service';

export class CreateSupplierReturnDto {
  returned_barcode: string;
  returned_name?: string;
  returned_qty: number;
  /** 'no_replacement' | 'replaced' | 'pending_replacement' */
  return_type: string;
  replacement_barcode?: string;
  replacement_name?: string;
  replacement_modal?: string;
  replacement_qty?: number;
  notes?: string;
}

export class ReceiveReplacementDto {
  replacement_barcode: string;
  replacement_name?: string;
  replacement_modal?: string;
  replacement_qty: number;
}

@Injectable()
export class SupplierReturnsService {
  constructor(
    @InjectModel(SupplierReturn.name) private model: Model<SupplierReturn>,
    private products: ProductsService,
  ) {}

  async create(data: CreateSupplierReturnDto) {
    if (!data.returned_barcode || !data.returned_qty || data.returned_qty < 1) {
      throw new BadRequestException('returned_barcode and returned_qty (≥1) are required');
    }
    if (!['no_replacement', 'replaced', 'pending_replacement'].includes(data.return_type)) {
      throw new BadRequestException('return_type must be no_replacement, replaced, or pending_replacement');
    }

    // Sending item back to supplier = deduct from our stock
    await this.products.sellUnit(data.returned_barcode, data.returned_qty);

    // If already knows the replacement item, restock it immediately
    if (data.return_type === 'replaced' && data.replacement_barcode && (data.replacement_qty ?? 0) > 0) {
      await this.products.restockUnit(data.replacement_barcode, data.replacement_qty!);
    }

    return this.model.create({
      ...data,
      received: data.return_type === 'replaced', // 'replaced' means already fully resolved
    });
  }

  async findAll(limit = 100) {
    return this.model.find().sort({ created_at: -1 }).limit(limit).exec();
  }

  async findOne(id: string) {
    const sr = await this.model.findById(id);
    if (!sr) throw new NotFoundException('Supplier return not found');
    return sr;
  }

  /**
   * Mark a pending_replacement return as received.
   * For pending_replacement: replacement details arrive now — update record + restock.
   * Idempotent — calling twice won't double-add stock.
   */
  async receiveReplacement(id: string, dto?: ReceiveReplacementDto) {
    const sr = await this.findOne(id);

    if (sr.received) {
      // Already processed — return current state, don't re-add stock
      return sr;
    }

    if (sr.return_type === 'no_replacement') {
      // Nothing to receive — just mark done
      sr.received = true;
      await sr.save();
      return sr;
    }

    if (sr.return_type === 'pending_replacement') {
      // Replacement details come in now
      if (!dto?.replacement_barcode || !dto.replacement_qty || dto.replacement_qty < 1) {
        throw new BadRequestException('replacement_barcode and replacement_qty required for pending_replacement');
      }
      await this.products.restockUnit(dto.replacement_barcode, dto.replacement_qty);
      sr.replacement_barcode = dto.replacement_barcode;
      sr.replacement_name = dto.replacement_name ?? '';
      sr.replacement_modal = dto.replacement_modal ?? '';
      sr.replacement_qty = dto.replacement_qty;
      sr.return_type = 'replaced';
      sr.received = true;
      await sr.save();
      return sr;
    }

    // return_type === 'replaced' but somehow received=false — just mark done (safety net)
    sr.received = true;
    await sr.save();
    return sr;
  }

  async delete(id: string) {
    const sr = await this.findOne(id);
    // NOTE: stock quantities are NOT reversed on delete — matches legacy app behaviour
    await this.model.findByIdAndDelete(id);
    return { success: true };
  }
}
