import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('products')
export class ProductsController {
  constructor(private readonly service: ProductsService) {}

  @Get() findAll(@Query() query: any) { return this.service.findAll(query); }
  
  @Get('generate-barcode')
  async generateBarcode() {
    const barcode = await this.service.generateBarcodeNumber();
    return { barcode, success: true };
  }
  
  @Get(':barcode') findOne(@Param('barcode') barcode: string) { return this.service.findByBarcode(barcode); }
  
  @Roles('owner')
  @Post() create(@Body() dto: CreateProductDto) { return this.service.create(dto); }
  
  @Roles('owner')
  @Patch(':id') update(@Param('id') id: string, @Body() body: any) {
    return this.service.update(id, body.data, body.expectedVersion);
  }
  
  @Roles('owner')
  @Delete(':id') delete(@Param('id') id: string) { return this.service.delete(id); }
}
