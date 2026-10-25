import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';
import { Invoice, InvoiceSchema } from '../invoices/invoice.schema';
import { Product, ProductSchema } from '../products/product.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Product.name, schema: ProductSchema },
    ]),
  ],
  controllers: [BackupController],
  providers: [BackupService],
})
export class BackupModule {}
