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
  @Prop({ required: true, unique: true, index: true })
  invoice_no: string;

  @Prop({ index: true }) customer_name: string;
  @Prop({ index: true }) customer_phone: string;
  @Prop({ index: true }) cashier: string;
  @Prop({ default: 0 }) subtotal: number;
  @Prop({ default: 0 }) discount: number;
  @Prop({ default: 0 }) total: number;
  @Prop({ default: 0 }) paid_cash: number;
  @Prop({ default: 0 }) balance: number;
  @Prop({ default: 'unpaid', index: true }) status: string;
  @Prop({ default: 'sale', index: true }) transaction_type: string;
  @Prop({ default: '' }) return_reason: string;

  @Prop({ type: [InvoiceItemSchema], default: [] })
  items: InvoiceItem[];
}
export const InvoiceSchema = SchemaFactory.createForClass(Invoice);
