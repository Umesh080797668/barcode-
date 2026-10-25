import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class Product extends Document {
  @Prop({ required: true, unique: true, index: true })
  barcode: string;

  @Prop() name: string;
  @Prop() sku: string;
  @Prop() price: number;
  @Prop({ default: 0 }) quantity: number;
  @Prop({ default: 'normal' }) scan_mode: string;
  @Prop({ index: true }) category: string;

  // was TEXT-serialized JSON in SQLite — now a native object, no parse/stringify needed
  @Prop({ type: Object, default: {} })
  custom_fields: Record<string, any>;
}

export const ProductSchema = SchemaFactory.createForClass(Product);

// Compound text index for fast name/sku search
ProductSchema.index({ name: 'text', sku: 'text' });
