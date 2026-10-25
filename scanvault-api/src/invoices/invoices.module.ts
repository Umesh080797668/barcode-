import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Invoice, InvoiceSchema } from './invoice.schema';
import { Counter, CounterSchema } from '../common/counter.schema';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Counter.name, schema: CounterSchema },
    ]),
    ProductsModule, // InvoicesService depends on ProductsService for sellUnit/restockUnit
  ],
  controllers: [InvoicesController],
  providers: [InvoicesService],
})
export class InvoicesModule {}
