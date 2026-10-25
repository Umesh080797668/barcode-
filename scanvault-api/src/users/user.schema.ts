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
