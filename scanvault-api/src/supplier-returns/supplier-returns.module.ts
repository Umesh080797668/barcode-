import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SupplierReturn, SupplierReturnSchema } from './supplier-return.schema';
import { SupplierReturnsController } from './supplier-returns.controller';
import { SupplierReturnsService } from './supplier-returns.service';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: SupplierReturn.name, schema: SupplierReturnSchema }]),
    ProductsModule,
  ],
  controllers: [SupplierReturnsController],
  providers: [SupplierReturnsService],
})
export class SupplierReturnsModule {}
