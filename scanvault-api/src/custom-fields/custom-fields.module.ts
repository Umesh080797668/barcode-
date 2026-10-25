import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CustomField, CustomFieldSchema } from './custom-field.schema';
import { CustomFieldsController } from './custom-fields.controller';
import { CustomFieldsService } from './custom-fields.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: CustomField.name, schema: CustomFieldSchema }])],
  controllers: [CustomFieldsController],
  providers: [CustomFieldsService],
})
export class CustomFieldsModule {}
