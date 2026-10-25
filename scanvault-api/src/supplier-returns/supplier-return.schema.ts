import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: false } })
export class SupplierReturn extends Document {
  @Prop({ required: true, index: true }) returned_barcode: string;
  @Prop() returned_name: string;
  @Prop({ default: 1 }) returned_qty: number;
  /** 'no_replacement' | 'replaced' | 'pending_replacement' */
  @Prop({ default: 'no_replacement' }) return_type: string;
  @Prop() replacement_barcode: string;
  @Prop() replacement_name: string;
  @Prop() replacement_modal: string;
  @Prop({ default: 0 }) replacement_qty: number;
  @Prop() notes: string;
  @Prop({ default: false }) received: boolean;
}
export const SupplierReturnSchema = SchemaFactory.createForClass(SupplierReturn);
