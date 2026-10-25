import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CustomField } from './custom-field.schema';

@Injectable()
export class CustomFieldsService {
  constructor(@InjectModel(CustomField.name) private model: Model<CustomField>) {}

  async findAll() {
    return this.model.find().sort({ sort_order: 1 }).exec();
  }

  async create(data: any) {
    return this.model.create(data);
  }

  async delete(id: string) {
    return this.model.findByIdAndDelete(id).exec();
  }
}
