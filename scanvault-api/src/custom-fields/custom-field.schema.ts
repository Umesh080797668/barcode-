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
